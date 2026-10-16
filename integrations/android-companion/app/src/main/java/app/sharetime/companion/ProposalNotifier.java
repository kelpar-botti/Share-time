package app.sharetime.companion;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;

/** Only notifies this device. There is no messenger action, bot, reply, or remote input. */
final class ProposalNotifier {
    static void connectionProblem(Context context) {
        try {
            PrivateStore store = new PrivateStore(context);
            String tokenFingerprint = ConversationRules.digest(store.get("device-token", ""));
            if (tokenFingerprint.equals(store.get("warned-token", ""))) return;
            if (Build.VERSION.SDK_INT >= 33
                    && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (!manager.areNotificationsEnabled()) return;
            NotificationChannel channel = new NotificationChannel("connection", "接続の確認",
                    NotificationManager.IMPORTANCE_DEFAULT);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(channel);
            PendingIntent open = PendingIntent.getActivity(context, 0, new Intent(context, MainActivity.class),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            manager.notify("connection", 1, new Notification.Builder(context, "connection")
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("Share Time：連携キーの確認")
                    .setContentText("キーが無効または期限切れの可能性があります。アプリを開いて再設定してください。")
                    .setContentIntent(open).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build());
            store.put("warned-token", tokenFingerprint);
        } catch (Exception ignored) { }
    }

    static void showNew(Context context, JSONObject suggestion) {
        try {
            String id = suggestion.optString("id");
            if (id.isEmpty() || !"pending".equals(suggestion.optString("status", "pending"))) return;
            if (Build.VERSION.SDK_INT >= 33
                    && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (!manager.areNotificationsEnabled()) return;
            PrivateStore store = new PrivateStore(context);
            JSONArray seen = new JSONArray(store.get("notified-suggestions", "[]"));
            for (int i = 0; i < seen.length(); i++) if (id.equals(seen.getString(i))) return;
            NotificationChannel channel = new NotificationChannel("proposal", "予定の確認",
                    NotificationManager.IMPORTANCE_DEFAULT);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(channel);
            Intent intent = new Intent(context, MainActivity.class);
            PendingIntent open = PendingIntent.getActivity(context, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            // Names and message content are kept out of notification/lock-screen text.
            Notification notification = new Notification.Builder(context, "proposal")
                    .setSmallIcon(android.R.drawable.ic_menu_my_calendar)
                    .setContentTitle("Share Time：予定候補の確認")
                    .setContentText("日付を確認し、確定・変更・見送りを選んでください。")
                    .setVisibility(Notification.VISIBILITY_PRIVATE)
                    .setContentIntent(open).setAutoCancel(true).build();
            manager.notify(id.hashCode(), notification);
            JSONArray bounded = new JSONArray();
            for (int i = Math.max(0, seen.length() - 199); i < seen.length(); i++) bounded.put(seen.getString(i));
            bounded.put(id);
            store.put("notified-suggestions", bounded.toString());
        } catch (Exception ignored) { /* The proposal remains in the app even if alerts are unavailable. */ }
    }
}
