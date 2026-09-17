import Link from "next/link";
import { listBookings } from "@/lib/bookings";
import { cancelBooking, updateOwnerTitleVisibility } from "@/lib/actions";
import { addDays, currentMonthInJapan, formatJapaneseDate, isValidMonthString, OWNER_MAX_DAYS_AHEAD, todayInJapan } from "@/lib/date";
import OwnerScheduleForm from "@/components/OwnerScheduleForm";
import SubmitButton from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ month?: string; created?: string; skipped?: string; error?: string; saved?: string }> };
const ERROR_MESSAGES: Record<string, string> = {
  time: "開始時刻・終了時刻を正しく選択してください。",
  nodates: "カレンダーの日付、または繰り返しの曜日と期間を選んでください。",
  title: "公開する予定名を入力してください（100文字以内）。",
};

export default async function SchedulePage({ searchParams }: Props) {
  const { month: requestedMonth, created, skipped, error, saved } = await searchParams;
  const today = todayInJapan();
  const maxDate = addDays(today, OWNER_MAX_DAYS_AHEAD);
  const month = isValidMonthString(requestedMonth) && requestedMonth >= today.slice(0, 7) && requestedMonth <= maxDate.slice(0, 7) ? requestedMonth : currentMonthInJapan();
  const upcoming = (await listBookings({ source: "owner" })).filter(b => b.status !== "cancelled" && b.date >= today);
  const skippedDates = skipped ? skipped.split(",").filter(Boolean) : [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <Link href="/admin" className="inline-flex min-h-11 items-center text-sm font-medium text-blue-700 hover:underline">← 予約の管理に戻る</Link>
        <p className="eyebrow mt-3">MY SCHEDULE</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">自分の予定を登録</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">バイトや外出など、予約を受け付けない時間を登録できます。予定名の公開範囲も選べます。</p>
      </div>
      {created !== undefined && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><strong>{created}件の予定を登録しました。</strong>{skippedDates.length > 0 && <p className="mt-2 leading-relaxed">予約と重なったためスキップ：{skippedDates.map(formatJapaneseDate).join("、")}</p>}</div>}
      {error && ERROR_MESSAGES[error] && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{ERROR_MESSAGES[error]}</p>}
      <OwnerScheduleForm key={saved ?? "new"} initialMonth={month} today={today} maxDate={maxDate} />
      <section aria-labelledby="upcoming-heading">
        <div className="mb-4 flex items-center justify-between"><h2 id="upcoming-heading" className="section-title">登録済みの予定</h2><span className="text-sm text-slate-600">今後 {upcoming.length}件</span></div>
        {upcoming.length === 0 ? <p className="surface p-6 text-sm text-slate-600">まだ予定がありません。上のフォームから登録できます。</p> : <ul className="space-y-3">{upcoming.map(b => <li key={b.id} className="surface p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold">{b.title || b.name}</h3><p className="mt-1 text-sm text-slate-600">{formatJapaneseDate(b.date)}<br />{b.startTime}〜{b.endTime <= b.startTime ? "翌日 " : ""}{b.endTime}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${b.titlePublic ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-700"}`}>{b.titlePublic ? "予定名を公開中" : "予定名は非公開"}</span></div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3"><form action={updateOwnerTitleVisibility.bind(null, b.id, !b.titlePublic)}><SubmitButton className="button-secondary" pendingLabel="変更中…">{b.titlePublic ? "予定名を非公開にする" : "予定名を公開する"}</SubmitButton></form><form action={cancelBooking.bind(null, b.id)}><SubmitButton className="min-h-11 rounded-lg px-3 text-sm text-red-700 hover:bg-red-50" pendingLabel="取り消し中…">予定を取り消す</SubmitButton></form></div>
        </li>)}</ul>}
      </section>
    </div>
  );
}
