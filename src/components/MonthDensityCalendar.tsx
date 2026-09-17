import Link from "next/link";
import { getActiveBookingsForDateRange, splitBookingMinutesByDate } from "@/lib/bookings";
import { addDays, buildMonthGrid, formatJapaneseDate, formatJapaneseMonth, getMonthDateRange, getWeekday, todayInJapan, WEEKDAYS_JA } from "@/lib/date";
import { isJapaneseHoliday } from "@/lib/holidays";

// Google Maps の混雑度表示のように、埋まっている割合が高いほど濃い青にする。
// 背景色と文字色を別々に決めることで、日曜・祝日の赤文字をどの濃さの背景の上でも
// 綺麗に重ねられるようにしている。
function densityBgClass(ratio: number): string {
  if (ratio <= 0) return "bg-white border-gray-200";
  if (ratio < 0.25) return "bg-blue-100 border-blue-100";
  if (ratio < 0.5) return "bg-blue-300 border-blue-300";
  if (ratio < 0.75) return "bg-blue-700 border-blue-700";
  return "bg-blue-900 border-blue-900";
}

function densityTextClass(ratio: number): string {
  if (ratio <= 0) return "text-gray-700";
  if (ratio < 0.25) return "text-blue-900";
  if (ratio < 0.5) return "text-blue-950";
  return "text-white"; // ratio >= 0.5 (blue-700/blue-900 backgrounds)
}

function holidayTextClass(ratio: number): string {
  return ratio < 0.5 ? "text-red-800" : "text-red-100";
}

type Props = {
  /** "YYYY-MM" month to render. */
  month: string;
  /** A specific date to ring-highlight in addition to today (e.g. a pending request's date). */
  highlightDate?: string;
  /** Where tapping a day links to. Defaults to the public day view. */
  dayHref?: (date: string) => string;
  /** Open day links in a new tab — useful when embedded inside another workflow (e.g. the admin queue). */
  openInNewTab?: boolean;
  /** Show the color-scale legend below the grid. */
  showLegend?: boolean;
};

/**
 * The same day/time density heatmap the public calendar uses (see
 * src/app/page.tsx), factored out so it can also be embedded elsewhere —
 * e.g. next to a pending request, so the admin can see how busy the
 * surrounding days are before approving or rejecting. Deliberately shows
 * only aggregate density, nothing about individual bookings, exactly like
 * the public page.
 */
export default async function MonthDensityCalendar({
  month,
  highlightDate,
  dayHref = (date) => `/day?date=${date}`,
  openInNewTab = false,
  showLegend = true,
}: Props) {
  const today = todayInJapan();
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

  return (
    <div>
      <div className="text-lg font-bold text-center mb-4">{formatJapaneseMonth(month)}</div>
      <table className="w-full table-fixed text-center text-sm border-separate border-spacing-1">
        <caption className="sr-only">{formatJapaneseMonth(month)}の予約状況</caption>
        <thead>
          <tr>
            {WEEKDAYS_JA.map((w, index) => (
              <th
                key={w}
                scope="col"
                className={`text-xs font-medium pb-2 ${index === 0 ? "text-red-700" : "text-slate-600"}`}
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
                const isHighlighted = date === highlightDate;
                const isRedDay = getWeekday(date) === 0 || isJapaneseHoliday(date);
                const textClass = isRedDay ? holidayTextClass(ratio) : densityTextClass(ratio);
                const ring = isHighlighted
                  ? "ring-2 ring-offset-1 ring-amber-500"
                  : isToday
                    ? "ring-2 ring-offset-1 ring-blue-500"
                    : "";
                return (
                  <td key={dayIndex} className="p-0">
                    <Link
                      href={dayHref(date)}
                      target={openInNewTab ? "_blank" : undefined}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${formatJapaneseDate(date)}${isToday ? "、今日" : ""}、${ratio <= 0 ? "予定なし" : `予定あり（約${Math.round((minutesByDate.get(date) ?? 0) / 60 * 10) / 10}時間）`}${openInNewTab ? "、新しいタブで開く" : ""}`}
                      className={`relative flex min-h-11 items-center justify-center rounded-lg border py-2 font-medium transition hover:opacity-80 ${densityBgClass(
                        ratio
                      )} ${textClass} ${ring}`}
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

      {showLegend && (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-xs text-slate-600">
          <span>空き</span>
          <span className="w-3 h-3 rounded bg-white border border-gray-200" />
          <span className="w-3 h-3 rounded bg-blue-100" />
          <span className="w-3 h-3 rounded bg-blue-300" />
          <span className="w-3 h-3 rounded bg-blue-700" />
          <span className="w-3 h-3 rounded bg-blue-900" />
          <span>混雑</span>
          <span className="ml-3">青い枠：今日</span>
        </div>
      )}
    </div>
  );
}
