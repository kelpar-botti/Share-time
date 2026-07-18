import holidayJp from "@holiday-jp/holiday_jp";

/** Whether `dateStr` (YYYY-MM-DD) is a Japanese national holiday. */
export function isJapaneseHoliday(dateStr: string): boolean {
  return holidayJp.isHoliday(dateStr);
}
