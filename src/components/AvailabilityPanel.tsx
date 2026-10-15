"use client";

import { useActionState } from "react";
import type { Suggestion } from "@/lib/day-availability/closure.mjs";
import { analyzePastedConversation, createManualSuggestion, reviewSuggestion, pairCalendarDevice, revokeCalendarDevice, type ActionState } from "@/app/admin/(protected)/availability/actions";

const INITIAL: ActionState = { message: "" };
const SOURCES = { line: "LINE", discord: "Discord", manual: "手動" };
export type CalendarDevice = { id: string; name: string; createdAt: string; expiresAt: string; revoked: boolean };
const field = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900";

function Feedback({ state }: { state: ActionState }) {
  return state.message ? <p role={state.error ? "alert" : "status"} className={`mt-3 rounded-lg px-3 py-2 text-sm ${state.error ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-900"}`}>{state.message}</p> : null;
}

function SuggestionCard({ item, minDate, maxDate }: { item: Suggestion; minDate: string; maxDate: string }) {
  const [state, action, pending] = useActionState(reviewSuggestion, INITIAL);
  const dates = item.acceptedDates ?? item.dates;
  return <article className="rounded-xl border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{SOURCES[item.source]}</span>
      <span className={`rounded-full px-2 py-1 ${item.status === "pending" ? "bg-amber-50 text-amber-900" : item.status === "accepted" ? "bg-blue-50 text-blue-900" : "bg-slate-100 text-slate-600"}`}>{item.status === "pending" ? "確認待ち・受付は継続中" : item.status === "accepted" ? "終日受付停止に設定済み" : "見送り・変更なし"}</span>
    </div>
    <h3 className="mt-3 font-semibold text-slate-900">{item.summary}</h3>
    <p className="mt-2 text-sm text-slate-600">{dates.length ? `${dates.join("、")} ／ 終日` : "日付の指定が必要です"}</p>
    {item.evidence ? <details className="mt-3 text-sm"><summary className="cursor-pointer text-blue-700">判断に使った会話を確認</summary><pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-sans text-xs leading-6 text-slate-700">{item.evidence}</pre></details> : null}
    {item.status === "pending" ? <form action={action} className="mt-4">
      <input type="hidden" name="id" value={item.id} />
      <label className="block text-sm font-medium text-slate-700">受付停止する日（日付の変更もここでできます）
        {item.dates.length <= 1 ? <input type="date" name="dates" defaultValue={item.dates[0] ?? ""} min={minDate} max={maxDate} className={field} /> : <input name="dates" defaultValue={item.dates.join(", ")} placeholder="2026-10-24, 2026-10-25" className={field} />}
      </label>
      <p className="mt-2 text-xs leading-5 text-slate-500">確定すると、その日は新しい予約を受け付けません。すでにある予定は残ります。見送り・未操作では変更しません。</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="submit" name="decision" value="accept" disabled={pending} className="button-primary disabled:opacity-50">{pending ? "処理中…" : "この日を終日受付停止にする"}</button>
        <button type="submit" name="decision" value="dismiss" disabled={pending} className="button-secondary disabled:opacity-50">見送る（何もしない）</button>
      </div>
    </form> : null}
    <Feedback state={state} />
  </article>;
}

function PasteConversation({ defaultTimestamp, minDate, maxDate }: { defaultTimestamp: string; minDate: string; maxDate: string }) {
  const [state, action, pending] = useActionState(analyzePastedConversation, INITIAL);
  const [manualState, manualAction, manualPending] = useActionState(createManualSuggestion, INITIAL);
  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-bold">会話を取り込んで候補を作る</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">通知で取得できなかった返信や、すでに済んだ会話を補えます。ひとつの会話を古い順に、1発言1行で貼り付けてください。</p>
    <form action={action} className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">取り込み元<select name="source" className={field}><option value="line">LINE</option><option value="discord">Discord</option></select></label>
        <label className="text-sm font-medium">自分用の会話名<input name="thread" required maxLength={120} placeholder="例：友人との予定" className={field} /></label>
      </div>
      <label className="block text-sm font-medium">会話した日時（日本時間）<input type="datetime-local" name="occurredAt" required defaultValue={defaultTimestamp} className={field} /><span className="mt-1 block text-xs font-normal text-slate-500">「明日」「来週」の基準になります。複数日にまたがる会話では、日付を明記して貼り付けてください。</span></label>
      <label className="block text-sm font-medium">会話<textarea name="conversation" required rows={6} maxLength={12000} placeholder={"自分: 10月24日の18時にご飯行こう\n相手: いいよ、その日でお願い"} className={field} /><span className="mt-1 block text-xs font-normal text-slate-500">各行の先頭に「自分:」「相手:」を付けてください。最大80発言、各1500文字です。取り込んだ会話は公開されません。</span></label>
      <button disabled={pending} className="button-primary disabled:opacity-50">{pending ? "確認中…" : "会話から候補を作る"}</button>
    </form>
    <Feedback state={state} />
    <details className="mt-6 border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-medium text-blue-700">日付を指定して候補を作る</summary>
      <form action={manualAction} className="mt-4 space-y-3">
        <label className="block text-sm">日付<input type="date" name="dates" required min={minDate} max={maxDate} className={field} /></label>
        <label className="block text-sm">自分用のメモ<input name="summary" maxLength={500} placeholder="例：友人との予定" className={field} /></label>
        <button disabled={manualPending} className="button-secondary disabled:opacity-50">候補を作る</button>
      </form><Feedback state={manualState} />
    </details>
  </section>;
}

function DeviceCard({ device }: { device: CalendarDevice }) {
  const [state, action, pending] = useActionState(revokeCalendarDevice, INITIAL);
  return <li className="rounded-lg border border-slate-200 p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><p><span className="font-medium">{device.name}</span><span className="ml-2 text-slate-500">{device.revoked ? "解除済み" : `有効期限 ${device.expiresAt.slice(0, 10)}`}</span></p>
      {!device.revoked ? <form action={action}><input type="hidden" name="id" value={device.id} /><button disabled={pending} className="min-h-11 rounded-lg px-3 text-red-700 hover:bg-red-50 disabled:opacity-50">連携を解除</button></form> : null}</div>
    <Feedback state={state} />
  </li>;
}

function DevicePairing({ devices }: { devices: CalendarDevice[] }) {
  const [state, action, pending] = useActionState(pairCalendarDevice, INITIAL);
  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-bold">Androidとの連携</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">専用アプリで通知の読み取りを許可すると、LINE・Discordの合意らしい発言をきっかけに、その会話で保存した直前の文脈をShare Timeへ送ります。確認と日付変更はアプリからできます。PCの起動は不要です。</p>
    <p className="mt-2 text-sm leading-6 text-slate-600">アプリは相手のトークに参加しません。通知に含まれない過去の会話や、自分がアプリ・PCで送った返信をすべて取得することはできません。曖昧な場合は確認用の候補にします。</p>
    <details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-blue-700">初回の端末設定・連携キー</summary>
      <p className="mt-3 text-sm leading-6 text-slate-600">このキーを持つ端末は、あなたの候補の送信・確認・確定・見送りができます。ボタンを押すと90日間のアクセスを作成します。自分の専用アプリにだけ入力してください。</p>
      <form action={action} className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-48 flex-1 text-sm font-medium">端末名<input name="name" required maxLength={60} defaultValue="自分のXiaomi" className={field} /></label><button disabled={pending} className="button-secondary disabled:opacity-50">この端末の連携キーを作る</button></form>
      <Feedback state={state} />
      {state.token ? <label className="mt-3 block text-sm font-medium">今回の連携キー（この表示を閉じると再表示できません）<textarea readOnly value={state.token} rows={2} autoComplete="off" spellCheck={false} className={`${field} font-mono text-xs`} /><span className="mt-1 block text-xs font-normal text-slate-500">スクリーンショットや他人とのチャットへ貼らないでください。</span></label> : null}
      {devices.length ? <ul className="mt-4 space-y-2">{devices.map(device => <DeviceCard key={device.id} device={device} />)}</ul> : null}
    </details>
  </section>;
}

export default function AvailabilityPanel({ suggestions, devices, minDate, maxDate, defaultTimestamp }: { suggestions: Suggestion[]; devices: CalendarDevice[]; minDate: string; maxDate: string; defaultTimestamp: string }) {
  const pending = suggestions.filter(item => item.status === "pending");
  const processed = suggestions.filter(item => item.status !== "pending");
  return <div className="space-y-6">
    <section aria-labelledby="pending-title"><h2 id="pending-title" className="mb-3 text-lg font-bold">確認待ちの候補 <span className="text-slate-500">{pending.length}件</span></h2>
      {pending.length ? <div className="space-y-3">{pending.map(item => <SuggestionCard key={item.id} item={item} minDate={minDate} maxDate={maxDate} />)}</div> : <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">確認待ちの候補はありません。会話を取り込むか、Androidから候補を送るとここに表示されます。</p>}
    </section>
    <PasteConversation defaultTimestamp={defaultTimestamp} minDate={minDate} maxDate={maxDate} />
    <DevicePairing devices={devices} />
    {processed.length ? <details className="rounded-xl border border-slate-200 bg-slate-50 p-5"><summary className="cursor-pointer font-medium">確定・見送りの履歴（{processed.length}件）</summary><div className="mt-4 space-y-3">{processed.map(item => <SuggestionCard key={item.id} item={item} minDate={minDate} maxDate={maxDate} />)}</div></details> : null}
  </div>;
}
