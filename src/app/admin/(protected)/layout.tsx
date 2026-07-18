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
      <header className="border-b border-gray-200 bg-white px-4 py-3 flex items-center justify-between">
        <div className="font-bold">管理画面</div>
        <form action={adminSignOut}>
          <button type="submit" className="text-sm text-gray-500 hover:text-gray-800">
            ログアウト
          </button>
        </form>
      </header>
      <div className="flex-1 px-4 py-6">{children}</div>
    </div>
  );
}
