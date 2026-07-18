import Link from "next/link";
import { AdminLoginLink } from "@/components/AdminLoginLink";
import { getActiveBookingsForDateRange, splitBookingMinutesByDate } from "@/lib/bookings";
import {
  addDays,
  addMonths,
  buildMonthGrid,
  currentMonthInJapan,
  formatJapaneseMonth,
  getMonthDateRange,
  isValidMonthString,
  MAX_DAYS_AHEAD,
  todayInJapan,
  WEEKDAYS_JA,
} from "@/lib/date";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ month?: string }>;
};

// Google Maps の混雑度表示のように、埋まっている割合が高いほど濃い青にする。
function densityClass(ratio: number): string {
  if (ratio <= 0) return "bg-white text-gray-700 border-gray-200";
  if (ratio < 0.25) return "bg-blue-100 text-blue-900 border-blue-100";
  if (ratio < 0.5) return "bg-blue-300 text-blue-950 border-blue-300";
  if (ratio < 0.75) return "bg-blue-500 text-white border-blue-500";
  return "bg-blue-700 text-white border-blue-700";
}

export default async function HomePage({ searchParams }: Props) {
  const { month: monthParam } = await searchParams;
  const today = todayInJapan();
  const maxMonth = addDays(today, MAX_DAYS_AHEAD).slice(0, 7);
  const month = isValidMonthString(monthParam) ? monthParam : currentMonthInJapan();

  const weeks = buildMonthGrid(month);
  const [firstDay, lastDay] = getMonthDateRange(month);
  // Extend the fetch one day earlier than the grid so an overnight booking
  // that started the day before firstDay still counts toward firstDay.
  const bookings = await getActiveBookingsForDateRange(addDays(firstDay, -1), lastDay);

  const minutesByDate = new Map<string, number>();
  for (const b of bookings) {
    for (const { date, minutes } of splitBookingMinutesByDate(b)) {
      minutesByDate.set(date, (minutesByDate.get(date) ?? 0) + minutes);
    }
  }
  const minutesPerDay = 24 * 60;

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
        <div className="text-lg font-semibold">{formatJapaneseMonth(month)}</div>
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

      <table className="w-full text-center text-sm border-separate border-spacing-1">
        <thead>
          <tr>
            {WEEKDAYS_JA.map((w) => (
              <th key={w} className="text-xs font-normal text-gray-400 pb-1">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((date, dayIndex) => {
                if (!date) return <td key={dayIndex} />;
                const dayNumber = Number(date.slice(-2));
                const ratio = (minutesByDate.get(date) ?? 0) / minutesPerDay;
                const isToday = date === today;
                return (
                  <td key={dayIndex} className="p-0">
                    <Link
                      href={`/day?date=${date}`}
                      className={`flex items-center justify-center rounded-lg border py-3 transition hover:opacity-80 ${densityClass(
                        ratio
                      )} ${isToday ? "ring-2 ring-offset-1 ring-blue-500" : ""}`}
                    >
                      {dayNumber}
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-center gap-2 mt-6 text-xs text-gray-400">
        <span>空き</span>
        <span className="w-4 h-4 rounded bg-white border border-gray-200" />
        <span className="w-4 h-4 rounded bg-blue-100" />
        <span className="w-4 h-4 rounded bg-blue-300" />
        <span className="w-4 h-4 rounded bg-blue-500" />
        <span className="w-4 h-4 rounded bg-blue-700" />
        <span>混雑</span>
      </div>

      <AdminLoginLink />
    </main>
  );
}
