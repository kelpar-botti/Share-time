import Link from "next/link";

export function AdminLoginLink() {
  return (
    <p className="mt-8 border-t border-slate-200 pt-4 text-center text-sm text-slate-600">
      <Link href="/admin" className="inline-flex min-h-11 items-center rounded-lg px-4 hover:bg-white hover:text-blue-700">
        管理者ログイン
      </Link>
    </p>
  );
}
