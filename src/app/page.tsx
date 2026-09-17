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
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12">
      <header className="mb-7">
        <p className="eyebrow">SHARE TIME</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">空いている時間を、<br className="sm:hidden" />見つけよう。</h1>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">日付を選んで空き時間を確認し、予約を申請できます。</p>
        <ol aria-label="予約の流れ" className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
          <li><span className="font-bold text-blue-700">01</span> 日付を選ぶ</li>
          <li><span className="font-bold text-blue-700">02</span> 時間を選んで申請</li>
          <li><span className="font-bold text-blue-700">03</span> 管理者の承認で確定</li>
        </ol>
      </header>

      <section className="surface p-3 sm:p-6" aria-label="予約カレンダー">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        {canGoPrevMonth ? (
          <Link
            href={`/?month=${prevMonth}`}
            className="button-secondary"
          >
            ← 前の月
          </Link>
        ) : (
          <span aria-disabled="true" className="button-secondary opacity-40">
            ← 前の月
          </span>
        )}
        {month !== currentMonthInJapan() ? <Link href="/" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-blue-700 hover:underline">今月に戻る</Link> : <span className="text-xs font-medium text-slate-500">日付を選択</span>}
        {canGoNextMonth ? (
          <Link
            href={`/?month=${nextMonth}`}
            className="button-secondary"
          >
            次の月 →
          </Link>
        ) : (
          <span aria-disabled="true" className="button-secondary opacity-40">
            次の月 →
          </span>
        )}
      </div>

      <MonthDensityCalendar month={month} />
      <p className="mt-5 text-center text-xs leading-relaxed text-slate-600">色が濃い日ほど予定が多く入っています。<br />空き時間は日付を選んで確認できます。</p>
      </section>

      <AdminLoginLink />
    </main>
  );
}
