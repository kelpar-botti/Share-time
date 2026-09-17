import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { adminSignOut } from "@/lib/actions";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const isAdmin = !!session?.user?.email && session.user.email === process.env.ADMIN_EMAIL;

  if (!isAdmin) {
    redirect("/admin/login");
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-gray-200 bg-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin" className="flex min-h-11 items-center gap-3 font-bold text-slate-900">Share Time <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">管理画面</span></Link>
        <nav aria-label="管理画面のナビゲーション" className="flex flex-wrap items-center gap-4">
          <Link href="/" className="button-secondary">
            通常のページに戻る
          </Link>
          <form action={adminSignOut}>
            <button type="submit" className="min-h-11 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100">
              ログアウト
            </button>
          </form>
        </nav>
      </header>
      <div className="flex-1 px-4 py-6">{children}</div>
    </div>
  );
}
