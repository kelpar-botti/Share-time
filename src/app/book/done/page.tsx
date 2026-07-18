import Link from "next/link";
import { formatJapaneseDate, isValidDateString, isValidTimeString } from "@/lib/date";

type Props = {
  searchParams: Promise<{ date?: string; start?: string; end?: string }>;
};

export default async function BookDonePage({ searchParams }: Props) {
  const { date, start, end } = await searchParams;
  const hasRange = isValidDateString(date) && isValidTimeString(start) && isValidTimeString(end);

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
      <Link
        href={hasRange ? `/day?date=${date}` : "/"}
        className="text-blue-600 hover:underline"
      >
        予約状況に戻る
      </Link>
    </main>
  );
}
