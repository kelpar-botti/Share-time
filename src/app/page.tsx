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
  getWeekday,
  isValidMonthString,
  MAX_DAYS_AHEAD,
  todayInJapan,
  WEEKDAYS_JA,
} from "@/lib/date";
import { isJapaneseHoliday } from "@/lib/holidays";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ month?: string }>;
};

// Google Maps の混雑度表示のように、埋まっている割合が高いほど濃い青にする。
// 背景色と文字色を別々に決めることで、日曜・祝日の赤文字をどの濃さの背景の上でも
// 綺麗に重ねられるようにしている。
function densityBgClass(ratio: number): string {
  if (ratio <= 0) return "bg-white border-gray-200";
  if (ratio < 0.25) return "bg-blue-100 border-blue-100";
  if (ratio < 0.5) return "bg-blue-300 border-blue-300";
  if (ratio < 0.75) return "bg-blue-500 border-blue-500";
  return "bg-blue-700 border-blue-700";
}

function densityTextClass(ratio: number): string {
  if (ratio <= 0) return "text-gray-700";
  if (ratio < 0.25) return "text-blue-900";
  if (ratio < 0.5) return "text-blue-950";
  return "text-white"; // ratio >= 0.5 (blue-500/blue-700 backgrounds)
}

function holidayTextClass(ratio: number): string {
  return ratio < 0.5 ? "text-red-600" : "text-red-200";
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
            {WEEKDAYS_JA.map((w, index) => (
              <th
                key={w}
                className={`text-xs font-normal pb-1 ${index === 0 ? "text-red-500" : "text-gray-400"}`}
              >
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
                const isRedDay = getWeekday(date) === 0 || isJapaneseHoliday(date);
                const textClass = isRedDay ? holidayTextClass(ratio) : densityTextClass(ratio);
                return (
                  <td key={dayIndex} className="p-0">
                    <Link
                      href={`/day?date=${date}`}
                      className={`flex items-center justify-center rounded-lg border py-3 transition hover:opacity-80 ${densityBgClass(
                        ratio
                      )} ${textClass} ${isToday ? "ring-2 ring-offset-1 ring-blue-500" : ""}`}
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
