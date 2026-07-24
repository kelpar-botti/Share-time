import Link from "next/link";
import { getActiveBookingsForDateRange, splitBookingMinutesByDate } from "@/lib/bookings";
import { addDays, buildMonthGrid, formatJapaneseMonth, getMonthDateRange, getWeekday, todayInJapan, WEEKDAYS_JA } from "@/lib/date";
import { isJapaneseHoliday } from "@/lib/holidays";

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
      <div className="text-sm font-semibold text-center mb-2">{formatJapaneseMonth(month)}</div>
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
                      className={`flex items-center justify-center rounded-lg border py-2 transition hover:opacity-80 ${densityBgClass(
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
        <div className="flex items-center justify-center gap-2 mt-3 text-xs text-gray-400">
          <span>空き</span>
          <span className="w-3 h-3 rounded bg-white border border-gray-200" />
          <span className="w-3 h-3 rounded bg-blue-100" />
          <span className="w-3 h-3 rounded bg-blue-300" />
          <span className="w-3 h-3 rounded bg-blue-500" />
          <span className="w-3 h-3 rounded bg-blue-700" />
          <span>混雑</span>
        </div>
      )}
    </div>
  );
}
