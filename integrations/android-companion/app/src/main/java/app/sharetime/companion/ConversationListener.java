package app.sharetime.companion;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Reads only system-posted LINE/Discord notifications; no Accessibility or messenger replies. */
public final class ConversationListener extends NotificationListenerService {
    @Override public void onListenerConnected() {
        super.onListenerConnected();
        try {
            if (!enabled()) return;
            StatusBarNotification[] active = getActiveNotifications();
            if (active != null) for (StatusBarNotification notification : active) capture(notification);
            ConversationApi.flush(this, null);
        } catch (Exception ignored) { /* No chat, credential, or exception content is logged. */ }
    }

    @Override public void onNotificationPosted(StatusBarNotification notification) {
        try { if (enabled()) capture(notification); }
        catch (Exception ignored) { /* An unreadable notification must never change calendar state. */ }
    }

    private boolean enabled() {
        return "true".equals(new PrivateStore(this).get("capture-enabled", "false"));
    }

    private void capture(StatusBarNotification posted) throws Exception {
        String packageName = posted.getPackageName();
        String source;
        if ("jp.naver.line.android".equals(packageName)) source = "line";
        else if ("com.discord".equals(packageName)) source = "discord";
        else return;
        Notification notification = posted.getNotification();
        if ((notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        NotificationCompat.MessagingStyle style =
                NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification);
        String title = text(notification.extras.getCharSequence(Notification.EXTRA_TITLE));
        String conversationTitle = style == null ? "" : text(style.getConversationTitle());
        // App notification IDs/tags and display names are reusable. Without a conversation
        // shortcut, only messages in this one posted snapshot may share a history bucket.
        // Later snapshots stay isolated, even if this means needing a manual context import.
        String id = ConversationRules.notificationIdentity(source, posted.getUser().hashCode(),
                notification.getShortcutId(), posted.getKey(), posted.getPostTime());
        String label = conversationTitle.trim().isEmpty() ? title : conversationTitle;
        if (label.trim().isEmpty()) label = "通知から取得した会話";
        JSONArray incoming = new JSONArray();
        if (style != null) {
            List<NotificationCompat.MessagingStyle.Message> messages = new ArrayList<>(style.getHistoricMessages());
            messages.addAll(style.getMessages());
            for (NotificationCompat.MessagingStyle.Message message : messages) {
                String content = text(message.getText());
                if (content.trim().isEmpty() || message.getTimestamp() <= 0) continue;
                Person sender = message.getPerson();
                // Null sender has the documented MessagingStyle meaning 'current user'. A
                // non-null sender may still represent the user on some apps; never guess names.
                String direction = sender == null ? "self" : "unknown";
                String senderKey = sender == null ? "self" : text(sender.getKey()) + ":" + text(sender.getName());
                incoming.put(message(id, senderKey, direction, content, message.getTimestamp()));
            }
        }
        if (incoming.length() == 0) {
            CharSequence big = notification.extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
            String content = text(big == null ? notification.extras.getCharSequence(Notification.EXTRA_TEXT) : big);
            if (content.trim().isEmpty()) return;
            // Basic notifications do not reliably identify who sent a message.
            long timestamp = notification.when > 0 ? notification.when : posted.getPostTime();
            incoming.put(message(id, "unknown", "unknown", content, timestamp));
        }
        if (new ConversationCache(this).append(source, id, label, incoming, false)) {
            ConversationApi.flush(this, null);
        }
    }

    static JSONObject message(String conversationId, String senderKey, String sender,
                              String text, long timestamp) throws Exception {
        String bounded = ConversationRules.limit(text);
        return new JSONObject()
                .put("id", ConversationRules.digest(conversationId + ":" + senderKey + ":" + timestamp + ":" + bounded))
                .put("conversationId", conversationId).put("sender", sender).put("text", bounded)
                .put("sentAt", Instant.ofEpochMilli(timestamp).toString());
    }

    private static String text(CharSequence value) { return value == null ? "" : value.toString(); }
}
