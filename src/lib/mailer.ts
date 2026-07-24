import "server-only";
import nodemailer from "nodemailer";
import type { Booking } from "./types";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      "GMAIL_USER / GMAIL_APP_PASSWORD が設定されていません。.env.local を確認してください（README参照）。"
    );
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

function getAppUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

export async function sendBookingRequestEmail(booking: Booking): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error("ADMIN_EMAIL が設定されていません。.env.local を確認してください。");
  }

  const baseUrl = getAppUrl();
  const approveUrl = `${baseUrl}/r/${booking.id}?token=${booking.approveToken}&action=approve`;
  const rejectUrl = `${baseUrl}/r/${booking.id}?token=${booking.rejectToken}&action=reject`;
  const range = `${booking.startTime}〜${booking.endTime}`;
  const emailDisplay = booking.email || "(メールアドレスの記載なし)";
  const titleLine = booking.title
    ? `${booking.title}${booking.titlePublicAllowed ? "（予定名の公開を許可）" : "（予定名は非公開希望）"}`
    : "(なし)";

  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"予約サイト" <${process.env.GMAIL_USER}>`,
    to: adminEmail,
    ...(booking.email ? { replyTo: booking.email } : {}),
    subject: `【予約申請】${booking.date} ${range} - ${booking.name}様`,
    text: [
      "新しい予約申請が届きました。",
      "",
      `日時: ${booking.date} ${range}`,
      `予定名: ${titleLine}`,
      `お名前: ${booking.name}`,
      `メール: ${emailDisplay}`,
      `内容: ${booking.message || "(なし)"}`,
      "",
      `承認する: ${approveUrl}`,
      `却下する: ${rejectUrl}`,
      "",
      `管理画面: ${baseUrl}/admin`,
    ].join("\n"),
    html: `
      <div style="font-family: sans-serif; line-height: 1.6;">
        <h2>新しい予約申請</h2>
        <p><b>日時:</b> ${escapeHtml(booking.date)} ${escapeHtml(range)}</p>
        <p><b>予定名:</b> ${escapeHtml(titleLine)}</p>
        <p><b>お名前:</b> ${escapeHtml(booking.name)}</p>
        <p><b>メール:</b> ${escapeHtml(emailDisplay)}</p>
        <p><b>内容:</b> ${escapeHtml(booking.message || "(なし)")}</p>
        <p>
          <a href="${approveUrl}" style="display:inline-block;padding:10px 20px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;margin-right:8px;">承認する</a>
          <a href="${rejectUrl}" style="display:inline-block;padding:10px 20px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;">却下する</a>
        </p>
        <p><a href="${baseUrl}/admin">管理画面を開く</a></p>
      </div>
    `,
  });
}

/**
 * The requester changed the time on their own already-approved booking, so
 * it's back to "pending" — this tells the admin to re-approve or reject the
 * new time, reusing the same one-click links as the original request email.
 */
export async function sendBookingChangeRequestEmail(booking: Booking, previousRange: string): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error("ADMIN_EMAIL が設定されていません。.env.local を確認してください。");
  }

  const baseUrl = getAppUrl();
  const approveUrl = `${baseUrl}/r/${booking.id}?token=${booking.approveToken}&action=approve`;
  const rejectUrl = `${baseUrl}/r/${booking.id}?token=${booking.rejectToken}&action=reject`;
  const range = `${booking.startTime}〜${booking.endTime}`;
  const emailDisplay = booking.email || "(メールアドレスの記載なし)";

  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"予約サイト" <${process.env.GMAIL_USER}>`,
    to: adminEmail,
    ...(booking.email ? { replyTo: booking.email } : {}),
    subject: `【要再承認】${booking.date} の予約時間が変更されました - ${booking.name}様`,
    text: [
      "承認済みだった予約について、利用者が時間を変更しました。再度承認または却下してください。",
      "",
      `日時: ${booking.date} ${range}`,
      `変更前: ${booking.date} ${previousRange}`,
      `予定名: ${booking.title || "(なし)"}`,
      `お名前: ${booking.name}`,
      `メール: ${emailDisplay}`,
      "",
      `承認する: ${approveUrl}`,
      `却下する: ${rejectUrl}`,
      "",
      `管理画面: ${baseUrl}/admin`,
    ].join("\n"),
    html: `
      <div style="font-family: sans-serif; line-height: 1.6;">
        <h2>予約時間の変更（要再承認）</h2>
        <p>承認済みだった予約について、利用者が時間を変更しました。再度承認または却下してください。</p>
        <p><b>変更後の日時:</b> ${escapeHtml(booking.date)} ${escapeHtml(range)}</p>
        <p><b>変更前:</b> ${escapeHtml(booking.date)} ${escapeHtml(previousRange)}</p>
        <p><b>予定名:</b> ${escapeHtml(booking.title || "(なし)")}</p>
        <p><b>お名前:</b> ${escapeHtml(booking.name)}</p>
        <p><b>メール:</b> ${escapeHtml(emailDisplay)}</p>
        <p>
          <a href="${approveUrl}" style="display:inline-block;padding:10px 20px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;margin-right:8px;">承認する</a>
          <a href="${rejectUrl}" style="display:inline-block;padding:10px 20px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;">却下する</a>
        </p>
        <p><a href="${baseUrl}/admin">管理画面を開く</a></p>
      </div>
    `,
  });
}

export async function sendBookingDecisionEmail(
  booking: Booking,
  decision: "approved" | "rejected",
  replyMessage?: string
): Promise<void> {
  const baseUrl = getAppUrl();
  const transporter = getTransporter();
  const isApproved = decision === "approved";
  const range = `${booking.startTime}〜${booking.endTime}`;
  const replySection = replyMessage ? `\n\n${replyMessage}` : "";
  const titleManageSection =
    booking.title && booking.titleToken
      ? `\n\n予定名の公開設定を変更する: ${baseUrl}/title/${booking.id}?token=${booking.titleToken}`
      : "";

  await transporter.sendMail({
    from: `"予約サイト" <${process.env.GMAIL_USER}>`,
    to: booking.email,
    subject: isApproved
      ? `【予約確定】${booking.date} ${range} のご予約が確定しました`
      : `【予約について】${booking.date} ${range} のご予約申請について`,
    text: isApproved
      ? `${booking.name}様\n\n下記のご予約が確定しました。\n\n日時: ${booking.date} ${range}\n\n当日お待ちしております。${replySection}${titleManageSection}`
      : `${booking.name}様\n\n大変申し訳ございませんが、下記の日時はご予約いただけませんでした。\n\n日時: ${booking.date} ${range}\n\nお手数ですが、別の日時にて改めてお申し込みください。\n${baseUrl}${replySection}${titleManageSection}`,
  });
}
