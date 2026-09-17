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
      <p className="eyebrow mt-5"><Link href="/" aria-label="Share Time：カレンダーに戻る" className="inline-flex min-h-11 items-center rounded hover:underline">SHARE TIME</Link></p>
      <h1 className="text-2xl font-bold mt-2 mb-1">この日の予定</h1>
      <p className="text-sm text-gray-500 mb-6">
        24時間いつでも空いている時間帯を選んで予約を申請できます。
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
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
        <div className="order-first w-full text-center text-lg font-semibold sm:order-none sm:w-auto">{formatJapaneseDate(date)}</div>
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
              className="surface flex items-start gap-3 px-4 py-4 text-slate-700"
            >
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold">予約済み</span>
              <span className="min-w-0 break-words">
                <span className="font-semibold">{b.carriesFromPreviousDay ? "00:00" : b.startTime}〜{b.spillsIntoNextDay ? "翌日 " : ""}{b.endTime}</span>
                {b.carriesFromPreviousDay && <span className="ml-2 text-xs text-slate-600">前日から</span>}
                {b.titlePublic && b.title && <span className="mt-1 block text-sm">{b.title}</span>}
              </span>
            </div>
          ))
        )}
      </div>

      <Link
        href={`/book?date=${date}`}
        className="button-primary w-full"
      >
        この日の予約を申請する
      </Link>

      <AdminLoginLink />
    </main>
  );
}
