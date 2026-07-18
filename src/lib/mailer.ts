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

  await transporter.sendMail({
    from: `"予約サイト" <${process.env.GMAIL_USER}>`,
    to: booking.email,
    subject: isApproved
      ? `【予約確定】${booking.date} ${range} のご予約が確定しました`
      : `【予約について】${booking.date} ${range} のご予約申請について`,
    text: isApproved
      ? `${booking.name}様\n\n下記のご予約が確定しました。\n\n日時: ${booking.date} ${range}\n\n当日お待ちしております。${replySection}`
      : `${booking.name}様\n\n大変申し訳ございませんが、下記の日時はご予約いただけませんでした。\n\n日時: ${booking.date} ${range}\n\nお手数ですが、別の日時にて改めてお申し込みください。\n${baseUrl}${replySection}`,
  });
}
