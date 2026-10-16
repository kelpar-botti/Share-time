package app.sharetime.companion;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Seven-day, 80-message-per-thread cache; all text and metadata are encrypted at rest. */
final class ConversationCache {
    private static final Object LOCK = new Object();
    private static final int MAX_THREADS = 40;
    private final PrivateStore store;

    ConversationCache(Context context) { store = new PrivateStore(context); }

    private JSONObject read() throws JSONException {
        JSONObject root = new JSONObject(store.get("conversations", "{}"));
        long cutoff = System.currentTimeMillis() - ConversationRules.RETENTION_MS;
        List<String> removed = new ArrayList<>();
        java.util.Iterator<String> keys = root.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            JSONObject thread = root.getJSONObject(key);
            JSONArray old = thread.optJSONArray("messages");
            JSONArray kept = new JSONArray();
            if (old != null) for (int i = 0; i < old.length(); i++) {
                JSONObject message = old.getJSONObject(i);
                if (Instant.parse(message.getString("sentAt")).toEpochMilli() >= cutoff) {
                    kept.put(message);
                }
            }
            thread.put("messages", kept);
            if (kept.length() == 0) removed.add(key);
        }
        for (String key : removed) root.remove(key);
        return root;
    }

    boolean append(String source, String conversationId, String label, JSONArray incoming,
                   boolean manualAnalysis) throws JSONException {
        synchronized (LOCK) {
            JSONObject root = read();
            JSONObject thread = root.optJSONObject(conversationId);
            if (thread == null) {
                thread = new JSONObject().put("source", source).put("conversationId", conversationId)
                        .put("label", label).put("messages", new JSONArray());
                root.put(conversationId, thread);
            }
            JSONArray messages = thread.getJSONArray("messages");
            java.util.HashSet<String> ids = new java.util.HashSet<>();
            for (int i = 0; i < messages.length(); i++) ids.add(messages.getJSONObject(i).getString("id"));
            boolean cue = manualAnalysis;
            boolean added = false;
            long cutoff = System.currentTimeMillis() - ConversationRules.RETENTION_MS;
            for (int i = 0; i < incoming.length(); i++) {
                JSONObject message = incoming.getJSONObject(i);
                long sentAt = Instant.parse(message.getString("sentAt")).toEpochMilli();
                if (sentAt < cutoff || sentAt > System.currentTimeMillis() + 5 * 60 * 1000L) continue;
                if (messages.length() > 0 && incoming.length() == 1) {
                    JSONObject last = messages.getJSONObject(messages.length() - 1);
                    if ("unknown".equals(message.optString("sender"))
                            && last.optString("sender").equals(message.optString("sender"))
                            && last.optString("text").equals(message.optString("text"))) continue;
                }
                if (ids.add(message.getString("id"))) {
                    messages.put(message);
                    added = true;
                    cue |= ConversationRules.shouldAnalyze(message.getString("text"));
                }
            }
            List<JSONObject> sorted = new ArrayList<>();
            for (int i = 0; i < messages.length(); i++) sorted.add(messages.getJSONObject(i));
            sorted.sort(Comparator.comparingLong(item -> Instant.parse(item.optString("sentAt")).toEpochMilli()));
            JSONArray bounded = new JSONArray();
            for (int i = Math.max(0, sorted.size() - ConversationRules.MAX_MESSAGES); i < sorted.size(); i++) {
                bounded.put(sorted.get(i));
            }
            thread.put("messages", bounded);
            thread.put("updatedAt", System.currentTimeMillis());
            // A changed thread keeps its current revision until successful upload.
            if (added || manualAnalysis) thread.put("revision", ConversationRules.digest(bounded.toString()));
            if ((added && cue) || manualAnalysis) thread.put("outbox", true);
            List<String> all = new ArrayList<>();
            java.util.Iterator<String> keys = root.keys();
            while (keys.hasNext()) all.add(keys.next());
            all.sort(Comparator.comparingLong(key -> root.optJSONObject(key).optLong("updatedAt")));
            while (all.size() > MAX_THREADS) root.remove(all.remove(0));
            store.put("conversations", root.toString());
            return thread.optBoolean("outbox");
        }
    }

    JSONArray threads() throws JSONException {
        synchronized (LOCK) {
            JSONObject root = read();
            store.put("conversations", root.toString());
            JSONArray result = new JSONArray();
            java.util.Iterator<String> keys = root.keys();
            while (keys.hasNext()) result.put(root.getJSONObject(keys.next()));
            return result;
        }
    }

    void delivered(String conversationId, String revision) throws JSONException {
        synchronized (LOCK) {
            JSONObject root = read();
            JSONObject thread = root.optJSONObject(conversationId);
            if (thread != null && revision.equals(thread.optString("revision"))) {
                thread.put("outbox", false);
                store.put("conversations", root.toString());
            }
        }
    }
}
