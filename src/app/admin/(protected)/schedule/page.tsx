import Link from "next/link";
import { listBookings } from "@/lib/bookings";
import { cancelBooking, createOwnerScheduleBlocks } from "@/lib/actions";
import {
  addDays,
  addMonths,
  buildMonthGrid,
  currentMonthInJapan,
  formatJapaneseDate,
  formatJapaneseMonth,
  generateTimeOptions,
  getWeekday,
  isValidMonthString,
  OWNER_MAX_DAYS_AHEAD,
  todayInJapan,
  WEEKDAYS_JA,
} from "@/lib/date";
import { isJapaneseHoliday } from "@/lib/holidays";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    month?: string;
    created?: string;
    skipped?: string;
    error?: string;
  }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  time: "開始時刻・終了時刻を正しく選択してください。",
  nodates: "曜日と期間、またはカレンダーの日付を1つ以上選んでください。",
};

export default async function SchedulePage({ searchParams }: Props) {
  const { month: monthParam, created, skipped, error } = await searchParams;
  const today = todayInJapan();
  const maxDate = addDays(today, OWNER_MAX_DAYS_AHEAD);
  const maxMonth = maxDate.slice(0, 7);

  const month = isValidMonthString(monthParam) ? monthParam : currentMonthInJapan();
  const weeks = buildMonthGrid(month);
  const times = generateTimeOptions();

  const canGoPrevMonth = month > currentMonthInJapan();
  const canGoNextMonth = month < maxMonth;
  const prevMonth = addMonths(month, -1);
  const nextMonth = addMonths(month, 1);

  const upcoming = (await listBookings({ source: "owner" })).filter(
    (b) => b.status !== "cancelled" && b.date >= today
  );

  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;
  const skippedDates = skipped ? skipped.split(",").filter(Boolean) : [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:underline">
          ← 管理画面に戻る
        </Link>
        <h1 className="text-xl font-bold mt-2">自分の予定を登録する</h1>
        <p className="text-sm text-gray-500 mt-1">
          バイトなど、あなた自身の予定を直接ブロックできます（承認不要ですぐに反映されます）。
        </p>
      </div>

      {created !== undefined && (
        <div className="rounded border border-green-200 bg-green-50 text-green-700 px-3 py-2 text-sm">
          {created}件の予定を登録しました。
          {skippedDates.length > 0 && (
            <div className="mt-1">
              以下の日付は既に予約と重なっていたためスキップしました:{" "}
              {skippedDates.map((d) => formatJapaneseDate(d)).join("、")}
            </div>
          )}
        </div>
      )}
      {errorMessage && (
        <div className="rounded border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
          {errorMessage}
        </div>
      )}

      <form
        action={createOwnerScheduleBlocks}
        className="space-y-6 bg-white border border-gray-200 rounded-lg p-4"
      >
        <input type="hidden" name="month" value={month} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="startTime" className="block text-sm font-medium mb-1">
              開始時刻
            </label>
            <select
              id="startTime"
              name="startTime"
              required
              defaultValue=""
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="" disabled>
                選択してください
              </option>
              {times.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="endTime" className="block text-sm font-medium mb-1">
              終了時刻
            </label>
            <select
              id="endTime"
              name="endTime"
              required
              defaultValue=""
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="" disabled>
                選択してください
              </option>
              {times.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="label" className="block text-sm font-medium mb-1">
            メモ（任意・自分だけに表示されます）
          </label>
          <input
            id="label"
            name="label"
            maxLength={100}
            placeholder="例: バイト"
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
        </div>

        <fieldset className="border border-gray-200 rounded p-3">
          <legend className="text-sm font-medium px-1">曜日で繰り返し指定（任意）</legend>
          <div className="flex flex-wrap gap-3 mb-3">
            {WEEKDAYS_JA.map((label, index) => (
              <label key={index} className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="weekdays" value={index} className="rounded" />
                {label}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="rangeStart" className="block text-xs text-gray-500 mb-1">
                開始日
              </label>
              <input
                id="rangeStart"
                type="date"
                name="rangeStart"
                min={today}
                max={maxDate}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="rangeEnd" className="block text-xs text-gray-500 mb-1">
                終了日
              </label>
              <input
                id="rangeEnd"
                type="date"
                name="rangeEnd"
                min={today}
                max={maxDate}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="border border-gray-200 rounded p-3">
          <legend className="text-sm font-medium px-1">
            カレンダーから日付を選択（任意・タップで選択）
          </legend>

          <div className="flex items-center justify-between mb-2">
            {canGoPrevMonth ? (
              <Link
                href={`/admin/schedule?month=${prevMonth}`}
                className="px-2 py-1 rounded border border-gray-300 text-xs hover:bg-gray-100"
              >
                ← 前月
              </Link>
            ) : (
              <span className="px-2 py-1 rounded border border-gray-200 text-xs text-gray-300">
                ← 前月
              </span>
            )}
            <div className="text-sm font-semibold">{formatJapaneseMonth(month)}</div>
            {canGoNextMonth ? (
              <Link
                href={`/admin/schedule?month=${nextMonth}`}
                className="px-2 py-1 rounded border border-gray-300 text-xs hover:bg-gray-100"
              >
                次月 →
              </Link>
            ) : (
              <span className="px-2 py-1 rounded border border-gray-200 text-xs text-gray-300">
                次月 →
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mb-2">
            月を移動すると、この画面でまだ送信していない選択はリセットされます。
          </p>

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
                    if (!date) {
                      return <td key={dayIndex} />;
                    }
                    const selectable = date >= today && date <= maxDate;
                    const dayNumber = Number(date.slice(-2));
                    const isRedDay = getWeekday(date) === 0 || isJapaneseHoliday(date);
                    if (!selectable) {
                      return (
                        <td key={dayIndex} className="py-2 text-gray-300">
                          {dayNumber}
                        </td>
                      );
                    }
                    return (
                      <td key={dayIndex} className="p-0">
                        <label
                          className={`flex items-center justify-center rounded py-2 cursor-pointer hover:bg-blue-50 has-[:checked]:bg-blue-600 has-[:checked]:text-white transition ${
                            isRedDay ? "text-red-500" : ""
                          }`}
                        >
                          <input type="checkbox" name="dates" value={date} className="sr-only" />
                          {dayNumber}
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>

        <button
          type="submit"
          className="w-full bg-blue-600 text-white rounded px-4 py-2.5 font-medium hover:bg-blue-700 transition"
        >
          この内容で予定を登録する
        </button>
      </form>

      <section>
        <h2 className="text-lg font-bold mb-3">登録済みの予定（今後の分）</h2>
        {upcoming.length === 0 ? (
          <p className="text-gray-500 text-sm">登録されている予定はありません。</p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((b) => (
              <li
                key={b.id}
                className="bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between gap-3"
              >
                <div className="text-sm min-w-0">
                  <span className="font-medium">
                    {formatJapaneseDate(b.date)} {b.startTime}〜{b.endTime}
                  </span>
                  <span className="text-gray-500 ml-2 break-words">{b.name}</span>
                </div>
                <form action={cancelBooking.bind(null, b.id)}>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-100 shrink-0"
                  >
                    取り消す
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
