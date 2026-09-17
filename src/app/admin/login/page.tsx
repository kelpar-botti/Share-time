import Link from "next/link";
import { signIn } from "@/auth";

export default function AdminLoginPage() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <div className="surface p-6 sm:p-8">
      <p className="eyebrow mb-5"><Link href="/" aria-label="Share Time：カレンダーに戻る" className="inline-flex min-h-11 items-center rounded hover:underline">SHARE TIME</Link></p>
      <h1 className="text-xl font-bold mb-2">管理者ログイン</h1>
      <p className="text-gray-600 mb-8 text-sm">
        予約の承認・却下を行うには、管理者のGoogleアカウントでログインしてください。
      </p>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/admin" });
        }}
      >
        <button
          type="submit"
          className="button-primary w-full"
        >
          Googleでログイン
        </button>
      </form>
      <Link href="/" className="block mt-6 text-sm text-blue-600 hover:underline">
        ← 通常のページに戻る
      </Link>
      </div>
    </main>
  );
}
