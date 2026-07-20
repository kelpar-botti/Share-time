import Link from "next/link";
import { AdminLoginLink } from "@/components/AdminLoginLink";
import { formatJapaneseDate, isValidDateString, isValidTimeString } from "@/lib/date";

type Props = {
  searchParams: Promise<{ date?: string; start?: string; end?: string; id?: string; titleToken?: string }>;
};

export default async function BookDonePage({ searchParams }: Props) {
  const { date, start, end, id, titleToken } = await searchParams;
  const hasRange = isValidDateString(date) && isValidTimeString(start) && isValidTimeString(end);
  const hasManageLink = !!id && !!titleToken;

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <div className="text-4xl mb-4">✅</div>
      <h1 className="text-xl font-bold mb-2">予約申請を受け付けました</h1>
      {hasRange && (
        <p className="text-gray-600 mb-6">
          {formatJapaneseDate(date)} {start}〜{end}
        </p>
      )}
      <p className="text-gray-600 mb-8">
        管理者が確認し、承認されるとご予約が確定します。確定・見送りの結果はメールでお知らせします。
      </p>

      {hasManageLink && (
        <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-3 mb-8 text-left">
          予定名の公開・非公開はいつでも変更できます。このページを閉じると再表示できないので、必要な場合はリンクを保存してください:
          <br />
          <Link
            href={`/title/${id}?token=${titleToken}`}
            className="text-blue-600 hover:underline break-all"
          >
            {`/title/${id}?token=${titleToken}`}
          </Link>
        </p>
      )}

      <Link
        href={hasRange ? `/day?date=${date}` : "/"}
        className="text-blue-600 hover:underline"
      >
        予約状況に戻る
      </Link>

      <AdminLoginLink />
    </main>
  );
}
