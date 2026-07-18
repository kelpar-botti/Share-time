import Link from "next/link";
import { listBookings } from "@/lib/bookings";
import { approveBooking, rejectBooking } from "@/lib/actions";
import { formatJapaneseDate } from "@/lib/date";
import type { Booking, BookingStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<BookingStatus, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下",
  cancelled: "キャンセル",
};

function StatusPill({ status }: { status: BookingStatus }) {
  return (
    <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function BookingSummary({ booking }: { booking: Booking }) {
  return (
    <div className="min-w-0">
      <div className="font-medium">
        {formatJapaneseDate(booking.date)} {booking.startTime}〜{booking.endTime}
      </div>
      <div className="text-sm text-gray-600 break-words">
        {booking.name}
        {booking.email ? ` / ${booking.email}` : "（メールアドレスの記載なし）"}
      </div>
      {booking.message && (
        <div className="text-sm text-gray-500 mt-1 break-words">{booking.message}</div>
      )}
    </div>
  );
}

function HistoryCard({ booking }: { booking: Booking }) {
  return (
    <li className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <BookingSummary booking={booking} />
        <StatusPill status={booking.status} />
      </div>
    </li>
  );
}

function PendingCard({ booking }: { booking: Booking }) {
  return (
    <li className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <BookingSummary booking={booking} />
      </div>
      <form className="mt-3 space-y-2">
        {booking.email ? (
          <div>
            <label htmlFor={`reply-${booking.id}`} className="block text-xs text-gray-500 mb-1">
              返信メッセージ（任意・承認/却下どちらの場合も相手にメールで送られます）
            </label>
            <textarea
              id={`reply-${booking.id}`}
              name="replyMessage"
              rows={2}
              placeholder="例: ご予約ありがとうございます。当日お待ちしております。"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        ) : (
          <p className="text-xs text-gray-400">
            メールアドレスの記載がないため、返信メールは送信されません。
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            formAction={approveBooking.bind(null, booking.id)}
            className="px-3 py-1.5 rounded bg-green-600 text-white text-sm hover:bg-green-700"
          >
            承認
          </button>
          <button
            type="submit"
            formAction={rejectBooking.bind(null, booking.id)}
            className="px-3 py-1.5 rounded bg-red-600 text-white text-sm hover:bg-red-700"
          >
            却下
          </button>
        </div>
      </form>
    </li>
  );
}

export default async function AdminPage() {
  const bookings = await listBookings({ source: "visitor" });
  const pending = bookings.filter((b) => b.status === "pending");
  const history = bookings.filter((b) => b.status !== "pending");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <Link
        href="/admin/schedule"
        className="block text-center rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-medium hover:bg-gray-100 transition"
      >
        自分の予定を登録する（バイトなど）→
      </Link>

      <section>
        <h2 className="text-lg font-bold mb-3">承認待ち（{pending.length}件）</h2>
        {pending.length === 0 ? (
          <p className="text-gray-500 text-sm">現在、承認待ちの申請はありません。</p>
        ) : (
          <ul className="space-y-3">
            {pending.map((b) => (
              <PendingCard key={b.id} booking={b} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold mb-3">履歴</h2>
        {history.length === 0 ? (
          <p className="text-gray-500 text-sm">履歴はまだありません。</p>
        ) : (
          <ul className="space-y-3">
            {history.map((b) => (
              <HistoryCard key={b.id} booking={b} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
