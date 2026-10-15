import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/lib/firebase-admin";
import { todayInJapan, addDays } from "@/lib/date";
import { createClosureService } from "@/lib/day-availability/closure.mjs";
import { createDeviceService } from "@/lib/day-availability/devices.mjs";
import AvailabilityPanel from "@/components/AvailabilityPanel";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage() {
  await requireAdmin();
  const db = getDb();
  const ownerEmail = process.env.ADMIN_EMAIL!;
  const [suggestions, devices] = await Promise.all([
    createClosureService({ db, ownerEmail }).listSuggestions(),
    createDeviceService({ db, ownerEmail }).list(),
  ]);
  const today = todayInJapan();
  return <main className="mx-auto max-w-3xl">
    <p className="text-sm font-medium text-blue-700">Share Time ／ 予定の確認</p>
    <h1 className="mt-2 text-2xl font-bold text-slate-900">会話から、受付停止する日を確認</h1>
    <p className="mb-6 mt-3 text-sm leading-7 text-slate-600">日程への同意が見つかったら、直前の会話から終日受付停止の候補を作ります。日付を変更して確定するか、見送れます。あなたが確定するまでは、カレンダーは変わりません。</p>
    <AvailabilityPanel suggestions={suggestions} devices={devices} minDate={today} maxDate={addDays(today, 365)} defaultTimestamp={new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16)} />
  </main>;
}
