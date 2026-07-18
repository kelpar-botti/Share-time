# 予約サイト (reservation-app)

日時を選んで予約を申請 → あなたのGmailに通知 → メールのリンクまたは管理画面で承認/却下、
という個人向けの予約システムです。公開ページには「空き（○）／予約済み（×）」しか表示されず、
予約者の名前や内容は管理者（あなた）だけが見られます。

**永久無料で運用できる構成**を意識しています（クレジットカード登録も不要）。

## 構成

| 役割 | サービス | 理由 |
| --- | --- | --- |
| ホスティング / サーバー | [Vercel](https://vercel.com)（Hobbyプラン） | 永久無料、GitHub連携で自動デプロイ、カード登録不要 |
| データベース | [Firebase Firestore](https://firebase.google.com/)（Sparkプラン） | 永久無料、**一定期間アクセスが無くても自動停止しない**（Supabase無料枠は1週間で一時停止するため採用せず） |
| 管理者ログイン | Google Sign-In（[NextAuth.js](https://authjs.dev) v5） | あなたのGmailアカウントでそのままログイン、パスワード管理不要 |
| メール通知 | Gmail SMTP（[Nodemailer](https://nodemailer.com)） | あなたのGmailアカウントから直接送信、外部サービス不要で永久無料 |
| フレームワーク | Next.js 15 + TypeScript + Tailwind CSS | スマホ・タブレット・PCどれでも同じURLで閲覧可能（レスポンシブ対応） |

ほぼ全ページをサーバー側で描画しており、公開ページはクライアントJSにほとんど依存しません。
そのぶんコードが単純で、長期間ノーメンテナンスでも壊れにくい構成になっています。

## 使い方の流れ

### 訪問者側

1. トップページに月間カレンダーが表示され、予約が埋まっている日ほど濃い青で表示される（Googleマップの混雑度のようなイメージ）。月の移動ボタンでかなり先の月まで確認可能
2. 日付をタップすると、その日の予約済み時間帯（×）が確認できる詳細画面に移動する
3. 「この日の予約を申請する」から、開始時刻・終了時刻・お名前・内容を入力して申請（例: 13:00〜15:00）
   - **24時間いつでも申請可能**。終了時刻に開始時刻より早い時間を選ぶと「日をまたぐ予約」（例: 22:00〜翌2:00）として扱われます
   - お名前・内容は必須、メールアドレスは任意（結果をメールで受け取りたい場合のみ記載）
   - カレンダー・詳細画面のどちらにも、予約者名や内容は一切表示されません（管理者だけが確認できます）
4. 送信すると、その時間帯は即座に×（申請中）になり、あなたのGmailに通知メールが届く（お名前・内容も記載されます）
5. 通知メール内の「承認する」「却下する」リンクをクリックするだけで確定（管理画面へのログイン不要）
   - もちろん `/admin` の管理画面からまとめて承認/却下することも可能。予約の内容は承認待ち・履歴どちらの一覧でも確認できます
6. 申請者がメールアドレスを記載していた場合のみ、承認・却下の結果を自動通知（未記載の場合は送られません）

### 管理者（あなた）側

- `/admin` … 承認待ちの申請一覧（承認/却下）と、これまでの履歴
- `/admin/schedule` … バイトなど、あなた自身の予定を直接ブロックする画面
  - 承認不要ですぐに反映され、通知メールも送られません（自分の予定なので）
  - 同じ時間帯を複数日にまとめて登録できる、2つの方法を組み合わせられます
    1. **曜日で繰り返し指定**: 「月・水」「開始日〜終了日」を指定すると、その期間内の該当曜日すべてに一括登録
    2. **カレンダーからタップで選択**: 表示中の月のカレンダーで、個別の日付を直接タップして選択
  - 既に予約・予定が入っていて重なる日はスキップされ、結果が画面に表示されます
  - 登録した予定は一覧から「取り消す」でいつでも削除できます

## セットアップ手順

### 0. 前提

- Node.js がインストール済み（`node -v` で確認。18.18以上、または20.9以上を推奨）
- Googleアカウント（Gmail）を1つ持っている（管理者用に使うアカウント）

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. Firebase プロジェクトを作成する（データベース）

1. [Firebase コンソール](https://console.firebase.google.com/) を開き、「プロジェクトを作成」
2. 作成したプロジェクトの中で「Firestore Database」を有効化する
   - ロケーションは `asia-northeast1`（東京）を推奨
   - 開始モードは「本番環境モード」でOK（このアプリは全てサーバー経由でアクセスするため、
     Firestoreのセキュリティルールを個別に書く必要はありません）
3. 左メニューの歯車アイコン →「プロジェクトの設定」→「サービスアカウント」タブを開く
4. 「新しい秘密鍵の生成」をクリックして JSON ファイルをダウンロードする
5. ダウンロードしたJSONの中身から、次の3つの値を控える
   - `project_id` → `.env.local` の `FIREBASE_PROJECT_ID`
   - `client_email` → `.env.local` の `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `.env.local` の `FIREBASE_PRIVATE_KEY`（改行を含む長い文字列。ダブルクォートで囲んだままコピーする）

### 3. Google Sign-In を設定する（管理者ログイン用）

1. [Google Cloud Console](https://console.cloud.google.com/) を開き、Firebaseと同じプロジェクトを選ぶ
2. 「APIとサービス」→「OAuth同意画面」で、ユーザータイプは「外部」を選び、アプリ名など最低限の情報を入力
   - テストユーザーとして自分のGmailアドレスを追加しておく（公開審査は不要、個人利用のため）
3. 「認証情報」→「認証情報を作成」→「OAuthクライアントID」を選び、アプリケーションの種類は「ウェブアプリケーション」
4. 「承認済みのリダイレクトURI」に以下を追加する
   - ローカル開発用: `http://localhost:3000/api/auth/callback/google`
   - 本番用（Vercelのドメインが決まってから）: `https://あなたのドメイン/api/auth/callback/google`
5. 発行された「クライアントID」「クライアントシークレット」を控える
   - `.env.local` の `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`

### 4. Gmail のアプリパスワードを発行する（メール通知用）

1. 通知の送信元にしたいGmailアカウントで、[Googleアカウントの2段階認証プロセス](https://myaccount.google.com/security) を有効にする（アプリパスワードには2段階認証が必須）
2. [アプリパスワードの発行ページ](https://myaccount.google.com/apppasswords) で新しいアプリパスワードを作成する
3. 発行された16桁のパスワードを控える → `.env.local` の `GMAIL_APP_PASSWORD`（ふだんのログインパスワードとは別物です）

### 5. 環境変数ファイルを作成する

`.env.local.example` を `.env.local` にコピーして、ここまでで控えた値を埋めます。

```bash
cp .env.local.example .env.local
```

`AUTH_SECRET` は下記コマンドで生成できます。

```bash
npx auth secret
```

`ADMIN_EMAIL` と `GMAIL_USER` は基本的に同じGmailアドレスで問題ありません
（「そのアカウントでログインできる」かつ「そのアカウントから送信する」）。

### 6. ローカルで動作確認する

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) で公開ページ、
[http://localhost:3000/admin](http://localhost:3000/admin) で管理画面を確認できます。

### 7. Vercel にデプロイする

1. このプロジェクトを GitHub リポジトリに push する
2. [Vercel](https://vercel.com/new) でそのリポジトリをインポートする（無料のHobbyプランでOK、カード登録不要）
3. Vercelの「Environment Variables」に `.env.local` と同じ内容をすべて登録する
   - `APP_URL` は実際にデプロイされたURL（例: `https://your-app.vercel.app`）に変更する
4. デプロイ完了後、Google Cloud Console の OAuthクライアント設定に本番URLのリダイレクトURIを追加する
   （手順3の「本番用」の欄）
5. 以後は GitHub に push するたびに自動で再デプロイされます

## カスタマイズ

- **受付時間帯・選択の刻み幅**: `src/lib/date.ts` の `BUSINESS_HOURS`（初期値は24時間受付）と `TIME_STEP_MINUTES`（現在30分刻み）を編集してください。日をまたぐ予約は「終了時刻 ≦ 開始時刻」を「翌日まで」の意味として扱う仕組みになっているので、`BUSINESS_HOURS` を24時間未満に制限した場合はこの仕組みは使われません。
- **何日先まで予約を受け付けるか**: `src/lib/date.ts` の `MAX_DAYS_AHEAD`（訪問者向け、初期値365日）／`OWNER_MAX_DAYS_AHEAD`（管理者の予定登録用、初期値180日）
- **管理者アカウントの変更**: `.env.local` の `ADMIN_EMAIL` を変更するだけで、ログインできるGoogleアカウントが切り替わります。

## フォルダ構成

```
src/
  app/
    page.tsx                          公開トップページ（月間カレンダー、混み具合を色の濃さで表示）
    day/page.tsx                      日別の詳細画面（予約済み時間帯の確認・申請への入り口）
    book/page.tsx                     予約申請フォーム（開始/終了時刻を選択）
    book/done/page.tsx                申請完了画面
    r/[id]/page.tsx                    メール内の承認/却下リンクの着地ページ
    admin/login/page.tsx               管理者ログイン画面
    admin/(protected)/layout.tsx       管理画面の認証ガード
    admin/(protected)/page.tsx         管理画面本体（承認待ち一覧・履歴）
    admin/(protected)/schedule/page.tsx 自分の予定を登録する画面（バイトなど）
    api/auth/[...nextauth]/            NextAuthのOAuthエンドポイント
  auth.ts                             NextAuth設定（Google Sign-In、管理者メール制限）
  lib/
    date.ts                           日本時間の日付計算、営業時間、カレンダー生成
    firebase-admin.ts                  Firebase Admin SDK 初期化
    bookings.ts                       Firestoreへの予約データの読み書き（重複チェック含む）
    mailer.ts                         Gmail経由のメール送信
    actions.ts                        フォーム送信・承認/却下・予定登録のServer Actions
    admin.ts                          管理者権限チェック
    types.ts                          型定義（Booking, BookingSource など）
```

## 制限事項・今後の拡張候補

- 簡易的なボット対策として、予約フォームにハニーポット（隠しフィールド）を入れていますが、
  reCAPTCHA等の本格的なCAPTCHAは導入していません。スパムが多い場合は追加を検討してください。
- 同時に同じ時間帯へ申請が来た場合の競合防止は簡易的です（個人の予約サイトの利用頻度であれば問題になりません）。
- 訪問者からの申請（承認済み含む）自体をキャンセルするUIはまだありません。管理者自身の予定（`/admin/schedule`）だけ「取り消す」が可能です。
- Googleカレンダー連携、Discord通知などは未実装です。必要になったら追加できます。

## 無料枠の目安

- **Vercel Hobby**: 個人利用なら実質無制限。商用利用は不可なので注意。
- **Firebase Spark**: Firestore 読み取り5万回/日・書き込み2万回/日など。個人の予約サイトでは十分すぎる余裕があります。
- **Gmail送信**: 1日あたり500通程度の上限（個人アカウント）。予約通知用途では問題になりません。
