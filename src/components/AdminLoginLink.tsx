import Link from "next/link";

export function AdminLoginLink() {
  return (
    <p className="text-center text-xs text-gray-300 mt-10">
      <Link href="/admin/login" className="hover:text-gray-400 hover:underline">
        管理者ログイン
      </Link>
    </p>
  );
}
