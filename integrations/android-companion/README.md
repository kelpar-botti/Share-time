# Share Time Android 予定確認アプリ

LINE・Discordの通知を端末内へ蓄積し、同意や変更の表現を検出したときに前後の文脈から受付停止候補を提案する、個人用Androidアプリです。Android 8.0以降に対応します。**署名付きリリースAPKのビルド・Android Lint・署名検証を実施済みです。端末へのインストール、通知権限の設定、Xiaomi実機での通知取得は未実施・未確認です。**

## 動き方

1. 本人がShare Time所有者画面から端末用の連携キーを発行し、このアプリへ保存します。
2. 本人がアプリ内の検出スイッチを有効化し、Android設定で「通知へのアクセス」を許可します。候補の通知表示には別の通知許可も必要です。
3. 対象は `jp.naver.line.android` と `com.discord` の通知だけです。会話識別子はアプリと端末プロファイルを区別した通知のshortcut IDから作ったSHA-256です。shortcut IDがない場合、通知キーと投稿時刻による一回分の通知スナップショットとして分離します。通知IDや表示名が同じでも、別の投稿を同じ会話として蓄積しません。名前自体は識別子としてサーバーへ送りません。
4. 受信した本文を会話単位で最大80件保存します。受信・読み出し時に7日より古い本文を削除し、最大40会話に制限します。「了解」「OK」「それで」「変更」「中止」などを含む新規メッセージが来た場合のみ、その会話の直近合計12,000字以内をShare Time APIへ送信します。ローカル検出はきっかけで、同意の確定判断は行いません。
5. 提案は本人だけに通知します。アプリで候補日・根拠・確かさを確認し、日付を変更するか、終日停止を確定するか、見送れます。**確定のAPI呼び出しは本人が確認ダイアログの［確定］を押した場合だけです。** 見送りはカレンダーを変更しません。

時刻は会話を理解する材料です。受付停止の単位は本人の希望どおり終日です。既存予約の取消しは要求しません。通知には会話本文・名前・日付を表示せず、このアプリを開く操作だけを用意します。LINE/Discordの送信機能・Bot参加・通知返信・Accessibilityは実装していません。

## 読み取れる範囲と限界

- 通知に含まれる内容だけを扱います。インストール前の全履歴、通知が出ない会話、内容を隠した通知、画像・スタンプの意味は復元できません。起動時に取得できる既存分も、その時点で残っている通知だけです。
- 自分がアプリ内やPCから送信した発言は、Androidの通知に含まれない場合があります。自分の同意を常に検出できる仕組みではありません。PCとAndroidのトーク同期によって通知取得APIの範囲が広がるわけではありません。
- `MessagingStyle`の送信者がnullの場合のみ、Androidの定義に従い `self` とします。それ以外の送信者名から本人を推測せず `unknown` で送信します。これにより日付確認が必要な提案になる場合があります。
- 送信者が不明の同意は、日付を本人が指定する確認候補になります。日付の欄が空の場合は根拠の会話を確認して入力してください。
- shortcut IDを得られない通知は一回分のスナップショットへ分割します。この場合、同じ通知にアプリが含めた履歴だけを参照し、別々の通知の前後関係は自動で結合しません。必要な会話は共有・貼り付けで補ってください。同名で「新しい会話」を作っても別の会話として扱います。
- 読み取り漏れは「会話を貼り付けて提案を作る」またはAndroidの共有先から補います。本人がLINE/Discord、対象会話、日本時間の基準日時（例：`2026-10-16 18:00`）を選び、必要な前後のやり取りを明示的に送信します。過去7日以内・12,000字/80行以内です。行の順序を読み取り順として保持しますが、実際の各送信時刻を復元するものではありません。発言者は不明として扱い、勝手に本人の発言として登録しません。
- このアプリは常駐の定期ポーリングを行いません。通知受信・通知リスナー接続時に送信待ちを再試行し、明示的な「保留中の会話を再送」も使えます。通信失敗時にカレンダーの受付停止を確定しません。

## 保存と通信

連携キー、会話本文・名前・時刻、送信待ち、通知済み提案IDは、Android Keystoreの非エクスポートAES鍵を使ったAES-GCMで暗号化してアプリ専用領域へ保存します。OSバックアップを無効にしています。7日より古い本文の削除は次の受信・読み出し時に行うため、アプリを使っていない間の時限消去を保証するものではありません。暗号鍵を失った場合は読み取りを失敗させ、勝手に平文保存や新しい本人識別へ切り替えません。「接続解除」は端末内データを消去します。キーの失効、サーバーに送信済みのデータの扱いはShare Time所有者画面で確認してください。

通信先は `https://share-time-lyart.vercel.app/api/integrations/conversation` だけです。HTTP・別ホスト・URL内認証情報・クエリ・フラグメントを拒否し、リダイレクトへキーを転送しません。キーはAuthorizationヘッダーに入れ、ソース・ログ・URLへは含めません。通信は1ワーカー・待ち行列16件に制限し、接続15秒・読み取り30秒で打ち切ります。

401/403を受けたキーでは送信を休止し、本人へ再設定を知らせます。キーを入力して保存すると再接続を試せます。429では`Retry-After`を参照し、1分〜1時間の待機期間を設けます。送信待ち本文は成功応答を受けるまで保持します。待機時間の経過だけでは常駐処理を起動せず、次回通知・リスナー接続または本人の再送操作で試します。

```text
POST /api/integrations/conversation
Authorization: Bearer <本人が発行した端末用連携キー>
{source, conversationId, messages:[{id, conversationId, sender, text, sentAt}]}

GET /api/integrations/conversation
→ {ok:true, suggestions:[{id,status,dates,summary,evidence,confidence,existingBookingCount?}]}

PATCH /api/integrations/conversation
{id, action:"accept", dates:["2026-10-20"]}
または {id, action:"dismiss"}
```

送信本文の上限は128KiB、各メッセージは1,500 UTF-16文字、直近合計12,000文字以内です。クライアント側の上限に加え、サーバー側でも検証します。UIは `status:"pending"` の提案を表示し、日付が空なら本人が指定します。

## Xiaomiで本人が行う設定

配布された署名付きAPKを本人がインストールし、Share Timeの所有者画面で本人が発行した端末用連携キーをアプリへ保存してください。その後、アプリの検出スイッチを有効にし、Android設定の「通知へのアクセス」とアプリ自身の通知表示を許可します。自動的な権限付与や別アプリのデータ読み取りは行いません。端末用キーはパスワードと同じように扱い、相手のトークへ送信しないでください。

Xiaomi/HyperOSの機種・OSによって、アプリの「バックグラウンド自動起動」や省電力制限が通知監視に影響する可能性があります。機種に応じた設定を確認してください。一般的な案内は「設定 → アプリ → 権限 → バックグラウンド自動起動」です。実機で、画面ロック中・アプリを閉じた状態・PC使用中にもLINEとDiscordそれぞれの通知が届くことを確認する必要があります。通知本文を隠したままでは候補検出に使える情報が不足する場合があります。

## ビルドの前提

- Android SDK Platform 34 / Android SDK Build Tools 34.0.0
- JDK 17以上（このPCではJDK 21でビルド済み）
- 同梱のGradle 8.7 wrapper（配布ZIPのSHA-256を固定）
- MavenのAndroid Gradle Plugin 8.3.0、AndroidX Core 1.12.0および推移依存の取得環境

SDKは本人の規約同意に基づいてこのPCへ導入済みです。別の環境で再ビルドする場合は、SDKのライセンスを確認し、`local.properties`の`sdk.dir`または`ANDROID_HOME`をSDKへ向けてください。次を実行するとdebug APKの出力先は`app/build/outputs/apk/debug/app-debug.apk`です。

```powershell
.\gradlew.bat :app:assembleDebug :app:lintDebug
```

リリースは既存の専用署名鍵を使用し、`debuggable=false`でビルドしています。署名鍵とパスワードはGit・APK・ソースZIPに含めません。同じアプリを更新する際は同じ署名鍵を維持してください。再ビルド時は`SHARE_TIME_ANDROID_KEYSTORE`に鍵の絶対パス、`SHARE_TIME_ANDROID_KEYSTORE_PASSWORD`にパスワードを環境変数で渡し、`.\gradlew.bat :app:assembleRelease :app:lintRelease`を実行します。端末へのインストールと通知権限の付与は実行していません。

Androidを使わない小さなルール検査だけは、JDK 17以上で実行できます。Androidビルド・実機検証の代わりではありません。

```powershell
New-Item -ItemType Directory -Force work/rules-test
javac -d work/rules-test app/src/main/java/app/sharetime/companion/ConversationRules.java tests/ConversationRulesTest.java
java -cp work/rules-test app.sharetime.companion.ConversationRulesTest
```

## 実機で確認が必要な項目

LINE/Discord各1対1・グループ、前後会話の保持、self/unknownの扱い、同名の相手・別グループの分離、共有による補完、日付変更・見送り、確認前に受付停止しないこと、通信断・キー失効・画面ロック・再起動後、通知権限を解除した後、既存予約の維持、重複通知・二重確定の無害化を確認してください。

## 公式資料

- [Android NotificationListenerService](https://developer.android.com/reference/android/service/notification/NotificationListenerService)
- [AndroidX MessagingStyle](https://developer.android.com/reference/androidx/core/app/NotificationCompat.MessagingStyle)
- [MessagingStyle.Messageの送信者定義](https://developer.android.com/reference/android/app/Notification.MessagingStyle.Message)
- [通知返信履歴の範囲](https://developer.android.com/reference/android/app/Notification#EXTRA_REMOTE_INPUT_HISTORY)
- [Android Keystore](https://developer.android.com/privacy-and-security/keystore)
- [Xiaomiのバックグラウンド自動起動](https://www.mi.com/global/support/faq/details/KA-497677/)
