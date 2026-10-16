"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/lib/firebase-admin";
import { createClosureService, DayClosureError } from "@/lib/day-availability/closure.mjs";
import { createDeviceService, DeviceError } from "@/lib/day-availability/devices.mjs";
import { ingestConversation } from "@/lib/day-availability/ingest.mjs";
import type { ConversationMessage } from "@/lib/day-availability/conversation.mjs";

export type ActionState = { message: string; error?: boolean; token?: string };
function services() {
  const ownerEmail = process.env.ADMIN_EMAIL!;
  return { closures: createClosureService({ db: getDb(), ownerEmail }), devices: createDeviceService({ db: getDb(), ownerEmail }) };
}
function refresh() { revalidatePath("/admin/availability"); revalidatePath("/"); revalidatePath("/day"); revalidatePath("/book"); }
function failure(error: unknown): ActionState {
  if (error instanceof DayClosureError || error instanceof DeviceError) return { error: true, message: error.message };
  return { error: true, message: "処理に失敗しました。少し待ってから再試行してください。" };
}
function string(form: FormData, key: string) { const value = form.get(key); return typeof value === "string" ? value : ""; }
function datesFrom(form: FormData) { return string(form, "dates").split(/[\s,、]+/).filter(Boolean); }

export async function analyzePastedConversation(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const text = string(form, "conversation");
    const source = string(form, "source");
    const thread = string(form, "thread").trim();
    const occurredAt = string(form, "occurredAt");
    if (!text.trim() || text.length > 12000 || !thread || thread.length > 120 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(occurredAt)) return { error: true, message: "会話名・会話した日時・本文を入力してください。本文は合計12000文字までです。" };
    const timestamp = new Date(`${occurredAt}:00+09:00`);
    if (Number.isNaN(+timestamp)) return { error: true, message: "会話した日時を確認してください。" };
    const conversationId = `paste_${createHash("sha256").update(thread).digest("hex")}`;
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const messages: ConversationMessage[] = lines.map((line, index) => {
      const match = /^(自分|私|相手)\s*[:：]\s*(.*)$/.exec(line);
      return {
        id: createHash("sha256").update(`${occurredAt}:${index}:${line}`).digest("hex"), conversationId,
        sender: match?.[1] === "相手" ? "other" : match ? "self" : "unknown",
        // Preserve the pasted order even when the user supplies one timestamp
        // for the whole exchange (a correction followed by a fresh agreement).
        text: match?.[2] ?? line, sentAt: new Date(+timestamp + index).toISOString(),
      };
    });
    const result = await ingestConversation({ service: services().closures, input: { source, conversationId, messages }, allowHistoricalAgreement: true });
    refresh();
    if (!result.suggestion) return { message: "確かな合意と日付の組み合わせは見つかりませんでした。予定が決まっていれば、下の「日付を指定して候補を作る」から登録できます。" };
    if (result.suggestion.status !== "pending") return { message: "この会話の提案は処理済みです。同じ提案を新しく作成しませんでした。" };
    return { message: "候補を作りました。内容と日付を確認してから確定してください。受付状態はまだ変わっていません。" };
  } catch (error) { return failure(error); }
}

export async function createManualSuggestion(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const dates = datesFrom(form);
    if (!dates.length) return { error: true, message: "候補の日付を入力してください。" };
    await services().closures.createSuggestion({ dates, summary: string(form, "summary") || "日付を指定して作成した受付停止の候補", source: "manual" });
    refresh();
    return { message: "候補を作りました。下の候補を確定するまで受付状態は変わりません。" };
  } catch (error) { return failure(error); }
}

export async function reviewSuggestion(decision: "accept" | "dismiss", _state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const id = string(form, "id");
    if (decision === "dismiss") {
      await services().closures.dismissSuggestion(id);
      refresh();
      return { message: "見送りました。カレンダーは変更していません。" };
    }
    if (decision !== "accept") return { error: true, message: "操作を確認してください。" };
    const result = await services().closures.acceptSuggestion(id, datesFrom(form));
    refresh();
    return { message: `${result.suggestion.acceptedDates?.join("、")} を終日受付停止にしました。${result.existingBookingCount ? `既存の予定${result.existingBookingCount}件は維持しています。` : ""}` };
  } catch (error) { return failure(error); }
}

/** Creating persistent device access requires the owner's explicit button press in this form. */
export async function pairCalendarDevice(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const result = await services().devices.issue(string(form, "name"));
    revalidatePath("/admin/availability");
    return { message: "連携キーを作成しました。自分のAndroidアプリにだけ入力してください。有効期間は90日です。", token: result.token };
  } catch (error) { return failure(error); }
}

export async function revokeCalendarDevice(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    await services().devices.revoke(string(form, "id"));
    revalidatePath("/admin/availability");
    return { message: "この端末の連携を解除しました。" };
  } catch (error) { return failure(error); }
}
