"use client";

import { useState } from "react";
import { createOwnerScheduleBlocks } from "@/lib/actions";
import { addMonths, buildMonthGrid, formatJapaneseDate, formatJapaneseMonth, generateTimeOptions, getWeekday, WEEKDAYS_JA } from "@/lib/date";
import { isJapaneseHoliday } from "@/lib/holidays";
import SubmitButton from "./SubmitButton";

export default function OwnerScheduleForm({ initialMonth, today, maxDate }: { initialMonth: string; today: string; maxDate: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [dates, setDates] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const times = generateTimeOptions();
  const weeks = buildMonthGrid(month);
  const sameTime = !!startTime && startTime === endTime;
  const overnight = !!startTime && !!endTime && endTime < startTime;

  return (
    <form action={createOwnerScheduleBlocks} className="surface space-y-8 p-5 sm:p-7">
      <input type="hidden" name="month" value={month} />
      {dates.map(date => <input key={date} type="hidden" name="dates" value={date} />)}
      <section className="space-y-4" aria-labelledby="schedule-details">
        <h2 id="schedule-details" className="section-title">1. 予定の内容</h2>
        <div>
          <label htmlFor="label" className="field-label">予定名 <span className="font-normal text-slate-500">（非公開の場合は任意）</span></label>
          <input id="label" name="label" value={label} onChange={e => setLabel(e.target.value)} required={isPublic} maxLength={100} placeholder="例：バイト、打ち合わせ" className="field-input" />
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <input type="checkbox" name="titlePublic" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-blue-700" aria-describedby="title-privacy-help" />
          <span><span className="block font-semibold text-slate-900">予定名を公開する</span><span id="title-privacy-help" className="mt-1 block text-sm leading-relaxed text-slate-600">チェックすると、誰でも見られる日別画面に予定名が表示されます。登録後も変更できます。</span></span>
        </label>
        <p className="text-sm text-slate-600" aria-live="polite">公開画面での表示：<strong className="break-words text-slate-900">{isPublic ? `予約済み · ${label.trim() || "予定名を入力してください"}` : "予約済み（予定名は表示しません）"}</strong></p>
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="startTime" className="field-label">開始時刻</label><select id="startTime" name="startTime" required value={startTime} onChange={e => setStartTime(e.target.value)} className="field-input"><option value="" disabled>選択</option>{times.map(t => <option key={t}>{t}</option>)}</select></div>
          <div><label htmlFor="endTime" className="field-label">終了時刻</label><select id="endTime" name="endTime" required value={endTime} onChange={e => setEndTime(e.target.value)} className="field-input" aria-describedby="time-help"><option value="" disabled>選択</option>{times.map(t => <option key={t}>{t}</option>)}</select></div>
        </div>
        <p id="time-help" className={`text-sm ${sameTime ? "text-red-700" : "text-slate-600"}`} aria-live="polite">{sameTime ? "開始時刻と終了時刻は、異なる時間を選んでください。" : overnight ? `${startTime}〜翌日 ${endTime} の予定です。` : "日をまたぐ予定は、終了時刻に翌日の時間を選んでください。"}</p>
      </section>

      <section className="space-y-4 border-t border-slate-200 pt-6" aria-labelledby="schedule-dates">
        <h2 id="schedule-dates" className="section-title">2. 日付を選ぶ</h2>
        <p className="text-sm text-slate-600">複数の日を選べます。月を移動しても入力と選択は残ります。</p>
        <div className="flex items-center justify-between gap-2">
          <button type="button" disabled={month <= today.slice(0, 7)} onClick={() => setMonth(addMonths(month, -1))} className="button-secondary" aria-label="前の月を表示">← 前月</button>
          <h3 className="font-bold" aria-live="polite">{formatJapaneseMonth(month)}</h3>
          <button type="button" disabled={month >= maxDate.slice(0, 7)} onClick={() => setMonth(addMonths(month, 1))} className="button-secondary" aria-label="次の月を表示">次月 →</button>
        </div>
        <table className="w-full table-fixed border-separate border-spacing-1 text-center text-sm">
          <caption className="sr-only">{formatJapaneseMonth(month)}の予定登録日</caption>
          <thead><tr>{WEEKDAYS_JA.map((day, i) => <th key={day} scope="col" className={`pb-2 font-medium ${i === 0 ? "text-red-700" : "text-slate-600"}`}>{day}</th>)}</tr></thead>
          <tbody>{weeks.map((week, i) => <tr key={i}>{week.map((date, j) => {
            if (!date) return <td key={j} />;
            const disabled = date < today || date > maxDate;
            const selected = dates.includes(date);
            const red = getWeekday(date) === 0 || isJapaneseHoliday(date);
            return <td key={date}><button type="button" disabled={disabled} aria-pressed={selected} aria-label={formatJapaneseDate(date)} onClick={() => setDates(previous => selected ? previous.filter(d => d !== date) : [...previous, date].sort())} className={`relative min-h-11 w-full rounded-lg border font-medium transition ${selected ? "border-blue-700 bg-blue-700 text-white" : disabled ? "border-transparent text-slate-300" : `border-slate-200 hover:bg-blue-50 ${red ? "text-red-700" : "text-slate-700"}`}`}>{Number(date.slice(-2))}{selected && <span aria-hidden="true" className="absolute right-0.5 top-0 text-[10px]">✓</span>}</button></td>;
          })}</tr>)}</tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-2"><p aria-live="polite" className="text-sm font-semibold">選択中：{dates.length}日 <span className="font-normal text-slate-600">（他の月も含む）</span></p>{dates.length > 0 && <button type="button" onClick={() => setDates([])} className="min-h-11 text-sm text-blue-700 hover:underline">選択をクリア</button>}</div>
        {dates.length > 0 && <details className="text-sm text-slate-600"><summary className="cursor-pointer py-2">選択した日付を確認</summary><p className="mt-2 leading-relaxed">{dates.map(formatJapaneseDate).join("、")}</p></details>}
      </section>

      <details className="rounded-xl border border-slate-200 p-4">
        <summary className="cursor-pointer font-semibold">曜日でまとめて登録する（任意）</summary>
        <p className="mb-4 mt-3 text-sm text-slate-600">期間と曜日を指定すると、上で選んだ日付に追加して登録できます。</p>
        <fieldset><legend className="sr-only">繰り返す曜日</legend><div className="mb-4 flex flex-wrap gap-2">{WEEKDAYS_JA.map((day, i) => <label key={day} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50"><input type="checkbox" name="weekdays" value={i} className="accent-blue-700" />{day}</label>)}</div></fieldset>
        <div className="grid gap-3 sm:grid-cols-2"><div><label htmlFor="rangeStart" className="field-label">開始日</label><input id="rangeStart" name="rangeStart" type="date" min={today} max={maxDate} className="field-input" /></div><div><label htmlFor="rangeEnd" className="field-label">終了日</label><input id="rangeEnd" name="rangeEnd" type="date" min={today} max={maxDate} className="field-input" /></div></div>
      </details>
      <div className="space-y-3"><SubmitButton pendingLabel="予定を登録しています…">予定を登録する</SubmitButton><p className="text-center text-xs leading-relaxed text-slate-600">登録するとすぐに反映されます。予約と重なる日付はスキップします。</p></div>
    </form>
  );
}
