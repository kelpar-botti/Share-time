// Japan has no daylight saving time, so a fixed UTC+9 offset is always
// correct for "what day/time is it in Japan right now" — no timezone
// database or library needed, and it works the same whether this runs on
// a UTC server (Vercel) or a developer's local machine.
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const MAX_DAYS_AHEAD = 365;

export function todayInJapan(): string {
  const jst = new Date(Date.now() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

export function isValidDateString(value: string | undefined | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isValidTimeString(value: string | undefined | null): value is string {
  return !!value && /^\d{2}:\d{2}$/.test(value);
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const next = new Date(base + days * 24 * 60 * 60 * 1000);
  return next.toISOString().slice(0, 10);
}

/** Number of whole days from `today` in Japan to `dateStr` (negative if in the past). */
export function daysFromToday(dateStr: string): number {
  const today = todayInJapan();
  const [ty, tm, td] = today.split("-").map(Number);
  const [y, m, d] = dateStr.split("-").map(Number);
  const diffMs = Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td);
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

export const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** 0 (Sunday) through 6 (Saturday), matching WEEKDAYS_JA indices. */
export function getWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function formatJapaneseDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = WEEKDAYS_JA[date.getUTCDay()];
  return `${y}年${m}月${d}日（${weekday}）`;
}

/** All date strings from `start` to `end`, inclusive. */
export function enumerateDates(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  const dates: string[] = [];
  for (let t = startMs; t <= endMs; t += 24 * 60 * 60 * 1000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

// Owner-created schedule blocks (e.g. a part-time job shift) represent the
// admin's real calendar, not a visitor request, so they're allowed a much
// longer horizon than MAX_DAYS_AHEAD.
export const OWNER_MAX_DAYS_AHEAD = 180;
export const MAX_SCHEDULE_RANGE_DAYS = 180;

export function currentMonthInJapan(): string {
  return todayInJapan().slice(0, 7); // "YYYY-MM"
}

export function isValidMonthString(value: string | undefined | null): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value);
}

export function addMonths(monthStr: string, months: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function formatJapaneseMonth(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  return `${y}年${m}月`;
}

export function getDaysInMonth(monthStr: string): number {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "YYYY-MM-DD" for the first and last calendar day of a "YYYY-MM" month. */
export function getMonthDateRange(monthStr: string): [string, string] {
  return [`${monthStr}-01`, `${monthStr}-${String(getDaysInMonth(monthStr)).padStart(2, "0")}`];
}

/**
 * Calendar grid for a "YYYY-MM" month: weeks of 7 cells each (Sun-first),
 * padded with null outside the month so it renders as a normal calendar.
 */
export function buildMonthGrid(monthStr: string): (string | null)[][] {
  const [y, m] = monthStr.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = getDaysInMonth(monthStr);

  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

export const BUSINESS_HOURS = {
  startHour: 9,
  endHour: 19,
};

export const TIME_STEP_MINUTES = 30;

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Selectable start/end times, from opening to closing, at TIME_STEP_MINUTES intervals (inclusive of closing time). */
export function generateTimeOptions(): string[] {
  const times: string[] = [];
  const start = BUSINESS_HOURS.startHour * 60;
  const end = BUSINESS_HOURS.endHour * 60;
  for (let m = start; m <= end; m += TIME_STEP_MINUTES) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    times.push(`${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  }
  return times;
}
