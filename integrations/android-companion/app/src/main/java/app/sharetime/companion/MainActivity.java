package app.sharetime.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Private confirmation UI. Only explicit acceptance sends a request to block calendar days. */
public final class MainActivity extends Activity {
    private LinearLayout content;
    private LinearLayout proposalList;
    private TextView status;
    private PrivateStore store;
    private boolean changingCapture;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        store = new PrivateStore(this);
        try {
            render(); handleShare(getIntent());
            if (!store.get("device-token", "").isEmpty()) refresh();
        }
        catch (Exception ignored) { recovery(); }
    }

    @Override public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        try { handleShare(intent); refresh(); }
        catch (Exception ignored) { setStatus("共有データを読み込めませんでした。"); }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private LinearLayout column() {
        LinearLayout result = new LinearLayout(this);
        result.setOrientation(LinearLayout.VERTICAL);
        result.setPadding(dp(16), dp(10), dp(16), dp(10));
        return result;
    }

    private TextView text(LinearLayout parent, String value, int size) {
        TextView result = new TextView(this);
        result.setText(value);
        result.setTextSize(size);
        result.setPadding(0, dp(6), 0, dp(6));
        parent.addView(result);
        return result;
    }

    private Button button(LinearLayout parent, String value, View.OnClickListener listener) {
        Button result = new Button(this);
        result.setText(value);
        parent.addView(result);
        result.setOnClickListener(listener);
        return result;
    }

    private EditText input(LinearLayout parent, String hint, String value) {
        EditText result = new EditText(this);
        result.setHint(hint);
        result.setText(value);
        result.setTextSize(16);
        // Keep tokens and pasted conversation text out of the system's saved view-state bundle.
        result.setSaveEnabled(false);
        result.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        parent.addView(result);
        return result;
    }

    private void render() {
        ScrollView scroll = new ScrollView(this);
        content = column();
        scroll.addView(content);
        setContentView(scroll);
        text(content, "Share Time 予定確認", 24);
        text(content, "会話から受付停止の日付を提案します。［確定］を押すまでは予約状況を変更しません。"
                + "日付は終日停止です。時刻は文脈の理解に使います。", 16);
        text(content, "接続先：share-time-lyart.vercel.app", 14);
        EditText token = input(content, "Share Timeで作成した端末用連携キー", "");
        token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        token.setSingleLine(true);
        token.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        boolean connected = !store.get("device-token", "").isEmpty();
        if (connected) token.setHint("連携キーは暗号化して保存済み（変更時のみ入力）");
        button(content, "接続情報を保存", view -> {
            try {
                String entered = token.getText().toString().trim();
                if (!entered.isEmpty()) {
                    if (!entered.matches("[A-Za-z0-9_-]{32,256}")) {
                        setStatus("連携キーの形式を確認してください。"); return;
                    }
                    store.put("device-token", entered);
                    store.put("blocked-token", "");
                    store.put("warned-token", "");
                } else if (store.get("device-token", "").isEmpty()) {
                    setStatus("Share Timeの所有者画面で端末用連携キーを作成して入力してください。"); return;
                }
                store.put("endpoint", ConversationApi.DEFAULT_ENDPOINT);
                token.setText("");
                token.setHint("連携キーは暗号化して保存済み（変更時のみ入力）");
                setStatus("保存しました。提案を更新して接続を確認できます。");
            } catch (Exception ignored) { setStatus("暗号化保存できませんでした。"); }
        });
        CheckBox capture = new CheckBox(this);
        capture.setText("LINE・Discordの通知から候補を検出する");
        capture.setChecked("true".equals(store.get("capture-enabled", "false")));
        content.addView(capture);
        capture.setOnCheckedChangeListener((button, checked) -> {
            if (changingCapture) return;
            if (!checked) {
                store.put("capture-enabled", "false");
                setStatus("新しい通知の保存・送信を停止しました。処理済みの受付停止はそのままです。");
                return;
            }
            changingCapture = true; capture.setChecked(false); changingCapture = false;
            new AlertDialog.Builder(this).setTitle("通知から予定候補を検出")
                    .setMessage("LINE・Discordの通知本文を会話ごとに端末内へ暗号化して最大7日間保存します。"
                            + "「了解」「それで」「変更」などを検出したとき、直前の取得済み会話をShare Timeへ送信して日付を提案します。"
                            + "相手のトークへの投稿は行いません。通知に出ない自分の発言・過去の履歴は取得できません。"
                            + "Androidの「通知へのアクセス」も本人の操作で許可してください。")
                    .setPositiveButton("有効にする", (dialog, which) -> {
                        try {
                            if (store.get("device-token", "").isEmpty()) {
                                setStatus("先に端末用連携キーを保存してください。"); return;
                            }
                            store.put("capture-enabled", "true");
                            changingCapture = true; capture.setChecked(true); changingCapture = false;
                            setStatus("検出を有効にしました。通知へのアクセスも許可してください。");
                        } catch (Exception ignored) { setStatus("設定を保存できませんでした。"); }
                    }).setNegativeButton("今はしない", null).show();
        });
        button(content, "Androidの通知へのアクセス設定", view -> {
            try { startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)); }
            catch (Exception ignored) { setStatus("Androidの設定から通知へのアクセスを開いてください。"); }
        });
        button(content, "候補のお知らせを許可", view -> {
            if (Build.VERSION.SDK_INT >= 33
                    && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 21);
            } else {
                try {
                    startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
                } catch (Exception ignored) { setStatus("Androidの設定でこのアプリの通知を許可してください。"); }
            }
        });
        button(content, "提案を更新（接続確認）", view -> refresh());
        button(content, "保留中の会話を再送", view -> {
            setStatus("送信待ちの会話を確認中…");
            ConversationApi.flush(this, true, (result, error) -> runOnUiThread(() -> {
                if (isDestroyed()) return;
                if (error != null) setStatus(error);
                else { setStatus("送信待ちの確認が終わりました。"); refresh(); }
            }));
        });
        button(content, "会話を貼り付けて提案を作る", view -> showImport(""));
        button(content, "端末内の履歴・キーを消去して接続解除", view ->
                new AlertDialog.Builder(this).setTitle("この端末の接続を解除")
                        .setMessage("端末内の履歴・キーを消去します。発行済みキーの失効はShare Timeの所有者画面で行ってください。"
                                + "サーバー上の提案や確定した受付停止は削除しません。")
                        .setPositiveButton("端末内を消去", (dialog, which) -> { store.clear(); render(); })
                        .setNegativeButton("戻る", null).show());
        status = text(content, "未確定の候補をここに表示します。", 14);
        proposalList = column();
        content.addView(proposalList);
        text(content, "通知に含まれた内容だけを読み取ります。自分がアプリ内やPCで送った発言は取得できないことがあります。"
                + "会話は最大80件・7日、解析に送るのは直近合計12,000字までです。読み取り漏れは共有・貼り付けで補えます。", 14);
    }

    private void setStatus(String value) {
        if (status != null) status.setText(value);
    }

    private void refresh() {
        setStatus("提案を確認中…");
        ConversationApi.submit(this, "GET", null, (result, error) -> runOnUiThread(() -> {
            if (isDestroyed()) return;
            if (error != null) { setStatus(error); return; }
            proposalList.removeAllViews();
            JSONArray suggestions = result.optJSONArray("suggestions");
            int count = 0;
            if (suggestions != null) for (int i = 0; i < suggestions.length(); i++) {
                JSONObject suggestion = suggestions.optJSONObject(i);
                if (suggestion == null || !"pending".equals(suggestion.optString("status", "pending"))) continue;
                addProposal(suggestion); count++;
            }
            setStatus(count == 0 ? "確認待ちの候補はありません。" : "確認待ち：" + count + "件");
        }));
    }

    private String datesText(JSONObject suggestion) {
        JSONArray dates = suggestion.optJSONArray("dates");
        List<String> values = new ArrayList<>();
        if (dates != null) for (int i = 0; i < dates.length(); i++) values.add(dates.optString(i));
        return String.join(", ", values);
    }

    private void addProposal(JSONObject suggestion) {
        LinearLayout card = column();
        card.setBackgroundColor(0xfff0f3f6);
        proposalList.addView(card);
        text(card, suggestion.optString("summary", "予定候補"), 20);
        text(card, "提案日：" + (datesText(suggestion).isEmpty() ? "日付の指定が必要です" : datesText(suggestion)) + "（終日）", 16);
        String evidence = suggestion.optString("evidence", suggestion.optString("reason", ""));
        if (!evidence.isEmpty()) text(card, "読み取りの根拠：" + evidence, 14);
        String confidence = suggestion.optString("confidence", "low");
        text(card, "読み取りの確かさ：" + ("high".equals(confidence) ? "高" : "medium".equals(confidence) ? "中" : "要確認"), 14);
        int bookings = suggestion.optInt("existingBookingCount", 0);
        if (bookings > 0) text(card, "この日には既存の予定が" + bookings + "件あります。自動取消しはしません。", 16);
        EditText dates = input(card, "YYYY-MM-DD（複数日はカンマ区切り）", datesText(suggestion));
        dates.setInputType(InputType.TYPE_CLASS_TEXT);
        button(card, "この日付で終日受付停止にする", view -> {
            List<String> parsed;
            try { parsed = ConversationRules.dates(dates.getText().toString()); }
            catch (Exception ignored) { setStatus("日付をYYYY-MM-DDで入力してください。複数日はカンマで区切れます。"); return; }
            new AlertDialog.Builder(this).setTitle("終日受付停止を確定")
                    .setMessage(String.join("\n", parsed) + "\n\nこの日の新規予約を停止します。既存の予約は取り消しません。")
                    .setPositiveButton("確定", (dialog, which) -> {
                        try {
                            JSONObject request = new JSONObject().put("id", suggestion.getString("id"))
                                    .put("action", "accept").put("dates", new JSONArray(parsed));
                            resolve(request, (Button) view);
                        } catch (Exception ignored) { setStatus("候補を読み込めませんでした。提案を更新してください。"); }
                    }).setNegativeButton("戻って変更", null).show();
        });
        button(card, "見送る（何もしない）", view -> {
            try {
                resolve(new JSONObject().put("id", suggestion.getString("id")).put("action", "dismiss"), (Button) view);
            } catch (Exception ignored) { setStatus("候補を読み込めませんでした。提案を更新してください。"); }
        });
    }

    private void resolve(JSONObject request, Button button) {
        button.setEnabled(false);
        ConversationApi.submit(this, "PATCH", request, (result, error) -> runOnUiThread(() -> {
            if (isDestroyed()) return;
            button.setEnabled(true);
            if (error != null) { setStatus(error); return; }
            setStatus("accept".equals(request.optString("action")) ? "受付停止を保存しました。" : "見送りました。カレンダーは変更していません。");
            refresh();
        }));
    }

    private void handleShare(Intent intent) {
        if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            CharSequence shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (shared != null) showImport(shared.toString());
            intent.setAction(Intent.ACTION_MAIN); // Do not import twice after refresh/recreation.
        }
    }

    private void showImport(String initial) {
        if (initial.length() > 12000) {
            setStatus("共有する会話は12,000字以内にしてください。必要な前後の会話に絞ってください。"); return;
        }
        LinearLayout form = column();
        text(form, "通知で取得できなかった会話を補います。送信前に相手・グループと日時を確認してください。"
                + "本文だけでは発言者を断定できないため「不明」として解析します。", 14);
        Spinner source = new Spinner(this);
        source.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[]{"LINE", "Discord"}));
        form.addView(source);
        Spinner threads = new Spinner(this);
        form.addView(threads);
        List<JSONObject> choices = new ArrayList<>();
        Runnable updateChoices = () -> {
            choices.clear(); choices.add(null);
            List<String> labels = new ArrayList<>(); labels.add("新しい会話（別の相手・グループ）");
            try {
                JSONArray cached = new ConversationCache(this).threads();
                String wanted = source.getSelectedItemPosition() == 0 ? "line" : "discord";
                for (int i = 0; i < cached.length(); i++) {
                    JSONObject thread = cached.getJSONObject(i);
                    if (wanted.equals(thread.optString("source"))) {
                        choices.add(thread); labels.add(thread.optString("label", "通知から取得した会話"));
                    }
                }
            } catch (Exception ignored) { setStatus("保存された会話を開けませんでした。"); }
            threads.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, labels));
        };
        source.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { updateChoices.run(); }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        updateChoices.run();
        EditText label = input(form, "新しい会話の名前（端末内の識別用）", "");
        EditText timestamp = input(form, "会話の基準日時（日本時間、例 2026-10-16 18:00）", ConversationRules.localTimestamp());
        EditText body = input(form, "同意と、その前の日程のやり取りを貼り付け", initial);
        body.setMinLines(5); body.setMaxLines(10);
        body.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        ScrollView scrolling = new ScrollView(this); scrolling.addView(form);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("会話を取り込む")
                .setView(scrolling).setPositiveButton("送信して候補を確認", null)
                .setNegativeButton("やめる", null).create();
        dialog.setOnShowListener(shown -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            try {
                if (store.get("device-token", "").isEmpty()) { setStatus("先に連携キーを保存してください。"); return; }
                String value = body.getText().toString().trim();
                if (value.isEmpty() || value.length() > 12000) { body.setError("1〜12,000字で入力してください。"); return; }
                long time = Instant.parse(ConversationRules.timestamp(timestamp.getText().toString())).toEpochMilli();
                if (time < System.currentTimeMillis() - ConversationRules.RETENTION_MS
                        || time > System.currentTimeMillis() + 5 * 60 * 1000L) {
                    timestamp.setError("過去7日以内の会話の日時を入力してください。"); return;
                }
                JSONObject choice = choices.get(threads.getSelectedItemPosition());
                String selectedSource = source.getSelectedItemPosition() == 0 ? "line" : "discord";
                String privateLabel = choice == null ? label.getText().toString().trim() : choice.getString("label");
                if (privateLabel.isEmpty()) { label.setError("相手またはグループを区別する名前を入力してください。"); return; }
                String id = choice == null ? ConversationRules.digest(selectedSource + ":manual:" + java.util.UUID.randomUUID())
                        : choice.getString("conversationId");
                JSONArray messages = new JSONArray();
                int ordinal = 0;
                for (String line : value.split("\\r?\\n")) {
                    if (line.trim().isEmpty()) continue;
                    for (int start = 0; start < line.length();) {
                        if (messages.length() >= ConversationRules.MAX_MESSAGES) {
                            body.setError("会話を80行以内に絞ってください。"); return;
                        }
                        int end = Math.min(line.length(), start + ConversationRules.MAX_TEXT);
                        if (end < line.length() && Character.isHighSurrogate(line.charAt(end - 1))) end--;
                        String fragment = line.substring(start, end);
                        start = end;
                        // Preserve paste order as a tie-break; this does not claim exact send times.
                        int sequence = ordinal++;
                        messages.put(ConversationListener.message(id, "manual:" + sequence, "unknown", fragment, time + sequence));
                    }
                }
                new ConversationCache(this).append(selectedSource, id, privateLabel, messages, true);
                // Manual import is an explicit user action and may run with passive capture off.
                dialog.dismiss();
                setStatus("共有した会話から候補を確認中…");
                ConversationApi.flushThread(this, id, (result, error) -> runOnUiThread(() -> {
                    if (isDestroyed()) return;
                    if (error != null) setStatus(error); else refresh();
                }));
            } catch (Exception ignored) { timestamp.setError("日本時間で、例：2026-10-16 18:00 の形式で入力してください。"); }
        }));
        dialog.show();
    }

    private void recovery() {
        content = column(); setContentView(content);
        text(content, "端末内の暗号化データを開けません。再設定には端末内の履歴とキーの消去が必要です。", 16);
        button(content, "端末内の履歴・キーを消去して再設定", view -> { store.clear(); render(); });
    }
}
