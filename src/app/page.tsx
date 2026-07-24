import Link from "next/link";
import { AdminLoginLink } from "@/components/AdminLoginLink";
import MonthDensityCalendar from "@/components/MonthDensityCalendar";
import { addDays, addMonths, currentMonthInJapan, isValidMonthString, MAX_DAYS_AHEAD, todayInJapan } from "@/lib/date";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ month?: string }>;
};

export default async function HomePage({ searchParams }: Props) {
  const { month: monthParam } = await searchParams;
  const today = todayInJapan();
  const maxMonth = addDays(today, MAX_DAYS_AHEAD).slice(0, 7);
  const month = isValidMonthString(monthParam) ? monthParam : currentMonthInJapan();

  const canGoPrevMonth = month > currentMonthInJapan();
  const canGoNextMonth = month < maxMonth;
  const prevMonth = addMonths(month, -1);
  const nextMonth = addMonths(month, 1);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold mb-1">予約カレンダー</h1>
      <p className="text-sm text-gray-500 mb-6">
        色が濃い日ほど予約が埋まっています。日付をタップすると、その日の空き時間を確認できます。
      </p>

      <div className="flex items-center justify-between mb-4">
        {canGoPrevMonth ? (
          <Link
            href={`/?month=${prevMonth}`}
            className="px-3 py-2 rounded border border-gray-300 text-sm hover:bg-gray-100"
          >
            ← 前の月
          </Link>
        ) : (
          <span className="px-3 py-2 rounded border border-gray-200 text-sm text-gray-300">
            ← 前の月
          </span>
        )}
        <div />
        {canGoNextMonth ? (
          <Link
            href={`/?month=${nextMonth}`}
            className="px-3 py-2 rounded border border-gray-300 text-sm hover:bg-gray-100"
          >
            次の月 →
          </Link>
        ) : (
          <span className="px-3 py-2 rounded border border-gray-200 text-sm text-gray-300">
            次の月 →
          </span>
        )}
      </div>

      <MonthDensityCalendar month={month} />

      <AdminLoginLink />
    </main>
  );
}
