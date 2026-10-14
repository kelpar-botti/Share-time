# Gmail → ジョブカン → Share Time

Google Apps Scriptが約5分ごとにGmailを確認し、シフト確定メールを見つけるとShare Timeへ通知します。Share TimeのVercelサーバーが本人の確定シフトを読み取り、**開始時刻から9時間**を予定として登録します。PCやCodexを開いておく必要はありません。

例：9:30開始 → 18:30まで。11:00開始 → 20:00まで。20:00開始 → 翌5:00まで。実際のシフト終了時刻の長さによらず9時間です。

## 初回設定

初期状態では自動登録は無効です。次の設定と実データのプレビュー確認が必要です。ログイン情報をソースやチャットへ貼らないでください。

### 1. Vercelのサーバー設定

[Vercel](https://vercel.com/dashboard)でShare Timeプロジェクトを開き、Settings → Environment Variablesへ次を追加します。Productionを対象にし、秘密値はSensitiveとして設定します。設定後は新しいデプロイが必要です。

| 名前 | 内容 |
|---|---|
| `SHIFT_SYNC_ENABLED` | 最初は `false`。プレビュー成功後に `true` |
| `SHIFT_SYNC_TOKEN` | この連携専用のランダムな64桁の16進数 |
| `JOBCAN_CLIENT_ID` | 勤怠会社ID |
| `JOBCAN_EMAIL` | モバイルマイページのメールアドレス、またはスタッフコード |
| `JOBCAN_PASSWORD` | **モバイルマイページ用**の現在のパスワード |
| `JOBCAN_STAFF_CODE` | 本人のスタッフコード。別のスタッフを同期しないため照合 |

既存の`ADMIN_EMAIL`とFirebase設定をそのまま使います。Gmailのアプリパスワードを新しく作る必要はありません。

連携トークンは、手元のNode.jsで次を実行して作れます。この値はVercelとApps Script以外へ共有しないでください。

```javascript
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### 2. Google Apps Script

1. シフトメールを受け取っているGoogleアカウントで[Apps Script](https://script.google.com/home)を開き、新しいプロジェクトを作成します。
2. `Code.gs`の内容をこのフォルダーの`Code.gs`に置き換えます。
3. プロジェクトの設定で「appsscript.json マニフェスト ファイルをエディタで表示する」を有効にし、`appsscript.json`もこのフォルダーのものに置き換えます。
4. プロジェクトの設定 → スクリプトプロパティに次の2項目を追加します。

| 名前 | 内容 |
|---|---|
| `SHARE_TIME_SYNC_URL` | `https://share-time-lyart.vercel.app/api/integrations/jobcan` |
| `SHARE_TIME_SYNC_TOKEN` | Vercelの`SHIFT_SYNC_TOKEN`と同じ値 |

標準の独自Google Cloudプロジェクトに切り替えた場合は、そのプロジェクトでGmail APIも有効にしてください。標準構成ではマニフェストがGmailサービスを指定しています。

### 3. プレビューと有効化

1. Apps Scriptで`previewLatest`を実行します。初回のGoogle認可はアカウント本人が行います。要求する範囲はGmailの読み取り、外部通信、自動実行トリガー管理です。
2. 戻り値の`results`に対象月とシフト一覧があり、開始から9時間になっていることを確認します。この操作は予定も処理済みメールも変更しません。`SHIFT_SYNC_ENABLED=false`のまま試せます。
3. Vercelの`SHIFT_SYNC_ENABLED`を`true`にして再デプロイします。
4. Apps Scriptの`syncConfirmedShifts`を1回実行します。Share Timeの管理画面と公開カレンダーで登録された時間を確認します。もう一度実行して重複しないことも確認します。
5. `setup`を実行すると、約5分ごとの定期実行が有効になります。トリガー一覧に`syncConfirmedShifts`が1件あることを確認します。

停止するときはApps Scriptの`stop`を実行します。緊急時はVercelの`SHIFT_SYNC_ENABLED=false`に変更して再デプロイします。

## 動作

- 対象は送信元`noreply@donuts.ne.jp`、件名「来月シフト確定のお知らせ」（「じゃんぱら」の末尾表記も対応）。45日以内の対象メールから月ごとに最新の通知を使います。
- 「来月」はメール送信日時の日本時間から判断します。勤務確認・申請の催促などは対象にしません。メールは読み取り専用で、既読状態・ラベルを変更しません。
- 月一覧の開始時刻だけに頼らず、全日の日詳細で本人の「確定シフト」を確認します。申請した時間や他スタッフの時間を取り込みません。
- 自動登録する予定名は「バイト」で初期状態は非公開。管理者は既存の管理画面から公開範囲を変更できます。
- 同じ通知の再実行は重複登録しません。新しい確定通知で、自動登録した将来のシフトだけ追加・更新・取り消しを行います。過去の予定、手入力の予定、訪問者の予約は変更しません。
- 全日を確認できなかった場合やログインできなかった場合は、予定・メール処理済み記録を更新しません。次の定期実行で再確認します。
- 一日に複数の異なる確定シフトがある形式には対応していません。ページ形式の変更や別件名の通知では取得処理・検知条件の更新が必要です。
- 他の予定と重なるシフトも本人の勤務時間として登録し、結果の`conflicts`に件数を返します。既存予約は変更しません。

## 確認状態

2026-10-15：本人のジョブカン画面構造を確認し、9時間の変換を含む自動テスト69件、型チェック、本番ビルドを確認しました。Googleの認可、Vercelの連携用秘密設定、実際のクラウドからのログイン・登録・定期実行は、初回設定後に別途確認が必要です。

公式資料：[Apps Scriptの定期実行](https://developers.google.com/apps-script/guides/triggers/installable)、[Googleサービスの認可](https://developers.google.com/apps-script/guides/services/authorization)、[ジョブカンのモバイル確定シフト](https://jobcan.zendesk.com/hc/ja/articles/201238905)。
