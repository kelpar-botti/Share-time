import { signIn } from "@/auth";

export default function AdminLoginPage() {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-24 text-center">
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
          className="w-full bg-gray-900 text-white rounded px-4 py-2.5 font-medium hover:bg-gray-800 transition"
        >
          Googleでログイン
        </button>
      </form>
    </main>
  );
}
