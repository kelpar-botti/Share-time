import Link from "next/link";
import { getBooking, respondToBookingByToken } from "@/lib/bookings";
import { sendBookingDecisionEmail } from "@/lib/mailer";
import { formatJapaneseDate } from "@/lib/date";
import type { BookingStatus } from "@/lib/types";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; action?: string }>;
};

function ResultMessage({ title, body }: { title: string; body?: string }) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <h1 className="text-xl font-bold mb-2">{title}</h1>
      {body && <p className="text-gray-600 mb-8">{body}</p>}
      <Link href="/admin" className="text-blue-600 hover:underline">
        管理画面を開く
      </Link>
    </main>
  );
}

function statusLabel(status: BookingStatus): string {
  switch (status) {
    case "approved":
      return "承認済み";
    case "rejected":
      return "却下済み";
    case "cancelled":
      return "キャンセル済み";
    default:
      return status;
  }
}

export default async function RespondPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { token, action } = await searchParams;

  if (!token || (action !== "approve" && action !== "reject")) {
    return (
      <ResultMessage
        title="リンクが正しくありません"
        body="メール内のリンクをそのままクリックしてください。"
      />
    );
  }

  const result = await respondToBookingByToken(id, token, action);

  if (!result.ok) {
    if (result.reason === "already_handled") {
      return (
        <ResultMessage
          title="この予約申請は既に処理済みです"
          body={`現在のステータス: ${statusLabel(result.status)}`}
        />
      );
    }
    return (
      <ResultMessage
        title="リンクが無効です"
        body="リンクの有効期限が切れているか、URLが正しくありません。"
      />
    );
  }

  const booking = await getBooking(id);
  if (booking?.email) {
    // The status change above already succeeded — a notification failure
    // here must not turn this into an error page for a successful action.
    try {
      await sendBookingDecisionEmail(booking, result.status === "approved" ? "approved" : "rejected");
    } catch (error) {
      console.error("メール送信に失敗しました:", error);
    }
  }

  return (
    <ResultMessage
      title={result.status === "approved" ? "予約を承認しました" : "予約を却下しました"}
      body={
        booking
          ? `${formatJapaneseDate(booking.date)} ${booking.startTime}〜${booking.endTime} - ${booking.name}様`
          : undefined
      }
    />
  );
}
