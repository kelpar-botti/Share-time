import Link from "next/link";
import { AdminLoginLink } from "@/components/AdminLoginLink";
import { getBookingsVisibleOnDate } from "@/lib/bookings";
import {
  addDays,
  daysFromToday,
  formatJapaneseDate,
  isValidDateString,
  MAX_DAYS_AHEAD,
  todayInJapan,
} from "@/lib/date";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ date?: string }>;
};

export default async function DayPage({ searchParams }: Props) {
  const params = await searchParams;
  const today = todayInJapan();
  const date = isValidDateString(params.date) ? params.date : today;
  const offset = daysFromToday(date);

  const visible = await getBookingsVisibleOnDate(date);

  const prevDate = addDays(date, -1);
  const nextDate = addDays(date, 1);
  const canGoPrev = offset > 0;
  const canGoNext = offset < MAX_DAYS_AHEAD;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <Link href={`/?month=${date.slice(0, 7)}`} className="text-sm text-blue-600 hover:underline">
        ← 月間カレンダーに戻る
      </Link>
      <h1 className="text-2xl font-bold mt-2 mb-1">予約状況</h1>
      <p className="text-sm text-gray-500 mb-6">
        24時間いつでも空いている時間帯を選んで予約を申請できます。
      </p>

      <div className="flex items-center justify-between mb-4">
        {canGoPrev ? (
          <Link
            href={`/day?date=${prevDate}`}
            className="px-3 py-2 rounded border border-gray-300 text-sm hover:bg-gray-100"
          >
            ← 前の日
          </Link>
        ) : (
          <span className="px-3 py-2 rounded border border-gray-200 text-sm text-gray-300">
            ← 前の日
          </span>
        )}
        <div className="text-lg font-semibold">{formatJapaneseDate(date)}</div>
        {canGoNext ? (
          <Link
            href={`/day?date=${nextDate}`}
            className="px-3 py-2 rounded border border-gray-300 text-sm hover:bg-gray-100"
          >
            次の日 →
          </Link>
        ) : (
          <span className="px-3 py-2 rounded border border-gray-200 text-sm text-gray-300">
            次の日 →
          </span>
        )}
      </div>

      <div className="space-y-2 mb-6">
        {visible.length === 0 ? (
          <p className="text-sm text-gray-500 rounded-lg border border-gray-200 bg-white px-4 py-3">
            この日はまだ予約が入っていません。
          </p>
        ) : (
          visible.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-100 px-4 py-3 text-gray-500"
            >
              <span className="text-lg leading-none">×</span>
              <span>
                {b.carriesFromPreviousDay ? "00:00" : b.startTime}〜{b.endTime}　予約済み
                {b.spillsIntoNextDay && !b.carriesFromPreviousDay && "（翌日まで）"}
                {b.carriesFromPreviousDay && "（前日から）"}
                {b.titlePublic && b.title && `　${b.title}`}
              </span>
            </div>
          ))
        )}
      </div>

      <Link
        href={`/book?date=${date}`}
        className="block text-center rounded-lg bg-blue-600 text-white py-3 font-medium hover:bg-blue-700 transition"
      >
        この日の予約を申請する
      </Link>

      <AdminLoginLink />
    </main>
  );
}
