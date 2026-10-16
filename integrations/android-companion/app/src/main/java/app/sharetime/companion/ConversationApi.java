package app.sharetime.companion;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;

final class ConversationApi {
    static final String DEFAULT_ENDPOINT = "https://share-time-lyart.vercel.app/api/integrations/conversation";
    private static final ThreadPoolExecutor EXECUTOR = new ThreadPoolExecutor(1, 1, 30,
            TimeUnit.SECONDS, new ArrayBlockingQueue<>(16), runnable -> {
                Thread thread = new Thread(runnable, "share-time-sync");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.AbortPolicy());
    static { EXECUTOR.allowCoreThreadTimeOut(true); }
    interface Callback { void done(JSONObject result, String error); }
    private static final class ApiFailure extends Exception {
        final int status;
        ApiFailure(int status) { this.status = status; }
    }

    private static String failure(Context context, Exception error, boolean queued) {
        if (error instanceof ApiFailure) {
            int code = ((ApiFailure) error).status;
            if (code == 401 || code == 403) {
                ProposalNotifier.connectionProblem(context);
                return "連携キーを確認できません。Share Timeの所有者画面で有効な端末用キーを作成し、再設定してください。";
            }
            if (code == 409) return "別の操作で候補が更新されました。提案を更新して内容を確認してください。";
            if (code == 429) return "ただいま送信が混み合っています。しばらく待ってから再試行してください。";
            if (code == 400) return "日付や会話の形式を確認してください。受付停止の日付は今日以降で指定してください。";
            if (code == 404) return "この候補は見つかりません。提案を更新してください。";
        }
        return queued ? "送信を保留しました。次回の通知受信時、または「保留中の会話を再送」で再試行できます。"
                : "接続できませんでした。接続先・連携キー・通信状態を確認してください。";
    }

    static String endpoint(String text) throws Exception {
        URI uri = new URI(text.trim());
        if (!"https".equalsIgnoreCase(uri.getScheme())
                || !"share-time-lyart.vercel.app".equalsIgnoreCase(uri.getHost())
                || (uri.getPort() != -1 && uri.getPort() != 443)
                || uri.getUserInfo() != null || uri.getFragment() != null || uri.getQuery() != null
                || !"/api/integrations/conversation".equals(uri.getPath())) throw new Exception();
        return uri.toASCIIString();
    }

    static void submit(Context context, String method, JSONObject body, Callback callback) {
        Context app = context.getApplicationContext();
        execute(() -> {
            try { callback.done(request(app, method, body), null); }
            catch (Exception error) { callback.done(null, failure(app, error, false)); }
        }, callback);
    }

    private static void execute(Runnable runnable, Callback callback) {
        try { EXECUTOR.execute(runnable); }
        catch (java.util.concurrent.RejectedExecutionException ignored) {
            if (callback != null) callback.done(null, "処理待ちです。少し待ってからもう一度お試しください。");
        }
    }

    static void flush(Context context, Callback callback) {
        flush(context, false, callback);
    }

    static void flush(Context context, boolean explicit, Callback callback) {
        Context app = context.getApplicationContext();
        execute(() -> {
            try {
                PrivateStore store = new PrivateStore(app);
                if (!explicit && !"true".equals(store.get("capture-enabled", "false"))) {
                    if (callback != null) callback.done(new JSONObject().put("ok", true), null);
                    return;
                }
                ConversationCache cache = new ConversationCache(app);
                JSONArray threads = cache.threads();
                JSONObject last = new JSONObject().put("ok", true);
                for (int i = 0; i < threads.length(); i++) {
                    JSONObject thread = threads.getJSONObject(i);
                    if (!thread.optBoolean("outbox")) continue;
                    if (!explicit && !"true".equals(store.get("capture-enabled", "false"))) break;
                    JSONObject payload = new JSONObject()
                            .put("source", thread.getString("source"))
                            .put("conversationId", thread.getString("conversationId"))
                            .put("messages", boundedContext(thread.getJSONArray("messages")));
                    last = request(app, "POST", payload);
                    cache.delivered(thread.getString("conversationId"), thread.optString("revision"));
                    JSONObject suggestion = last.optJSONObject("suggestion");
                    if (suggestion != null) ProposalNotifier.showNew(app, suggestion);
                }
                if (callback != null) callback.done(last, null);
            } catch (Exception error) {
                String message = failure(app, error, true);
                if (callback != null) callback.done(null, message);
            }
        }, callback);
    }

    static void flushThread(Context context, String conversationId, Callback callback) {
        Context app = context.getApplicationContext();
        execute(() -> {
            try {
                ConversationCache cache = new ConversationCache(app);
                JSONArray threads = cache.threads();
                for (int i = 0; i < threads.length(); i++) {
                    JSONObject thread = threads.getJSONObject(i);
                    if (!conversationId.equals(thread.optString("conversationId"))) continue;
                    JSONObject result = request(app, "POST", new JSONObject()
                            .put("source", thread.getString("source"))
                            .put("conversationId", conversationId)
                            .put("messages", boundedContext(thread.getJSONArray("messages"))));
                    cache.delivered(conversationId, thread.optString("revision"));
                    callback.done(result, null);
                    return;
                }
                throw new Exception();
            } catch (Exception error) {
                callback.done(null, failure(app, error, true));
            }
        }, callback);
    }

    private static JSONArray boundedContext(JSONArray messages) throws Exception {
        int total = 0;
        int start = messages.length();
        for (int i = messages.length() - 1; i >= 0; i--) {
            int length = messages.getJSONObject(i).getString("text").length();
            if (total + length > 12000) break;
            total += length;
            start = i;
        }
        JSONArray result = new JSONArray();
        for (int i = start; i < messages.length(); i++) result.put(messages.getJSONObject(i));
        return result;
    }

    private static JSONObject request(Context context, String method, JSONObject body) throws Exception {
        PrivateStore store = new PrivateStore(context);
        String url = endpoint(store.get("endpoint", DEFAULT_ENDPOINT));
        String token = store.get("device-token", "");
        if (token.isEmpty()) throw new Exception();
        String fingerprint = ConversationRules.digest(token);
        if (fingerprint.equals(store.get("blocked-token", ""))) throw new ApiFailure(401);
        long retryAt;
        try { retryAt = Long.parseLong(store.get("api-retry-after", "0")); }
        catch (NumberFormatException ignored) { retryAt = 0; }
        if (System.currentTimeMillis() < retryAt) throw new ApiFailure(429);
        HttpsURLConnection connection = (HttpsURLConnection) new URI(url).toURL().openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/json");
        try {
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 131072) throw new Exception();
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(bytes.length);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            }
            int status = connection.getResponseCode();
            if (status == 401 || status == 403) store.put("blocked-token", fingerprint);
            if (status == 429) {
                long delay = ConversationRules.retryDelay(connection.getHeaderField("Retry-After"), System.currentTimeMillis());
                store.put("api-retry-after", Long.toString(System.currentTimeMillis() + delay));
            }
            if (status != 200) throw new ApiFailure(status);
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (output.size() + count > 524288) throw new Exception();
                    output.write(buffer, 0, count);
                }
                JSONObject result = new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
                if (!result.optBoolean("ok")) throw new Exception();
                return result;
            }
        } finally { connection.disconnect(); }
    }

}
