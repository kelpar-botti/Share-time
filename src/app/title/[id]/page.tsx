import Link from "next/link";
import { getBookingByTitleToken } from "@/lib/bookings";
import { requestTimeChange, updateMyTitlePublicAllowed } from "@/lib/actions";
import { formatJapaneseDate, generateTimeOptions } from "@/lib/date";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; timeError?: string; timeUpdated?: string }>;
};

const TIME_ERROR_MESSAGES: Record<string, string> = {
  invalid: "開始時刻・終了時刻を正しく選択してください。",
  same: "現在と同じ時間、または開始時刻と終了時刻が同じです。時間を変えてください。",
  taken: "その時間帯は他の予約と重なっています。別の時間をお選びください。",
};

const STATUS_NOTES: Record<string, string> = {
  pending: "現在承認待ちのため、時間の変更はまだできません。承認された後に変更できます。",
  rejected: "この予約は却下されているため、時間の変更はできません。",
  cancelled: "この予約はキャンセルされているため、時間の変更はできません。",
};

function InvalidLink() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <h1 className="text-xl font-bold mb-2">リンクが無効です</h1>
      <p className="text-gray-600 mb-8">
        URLが正しくないか、リンクの有効期限が切れている可能性があります。
      </p>
      <Link href="/" className="text-blue-600 hover:underline">
        トップページに戻る
      </Link>
    </main>
  );
}

export default async function ManageBookingPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { token, timeError, timeUpdated } = await searchParams;

  if (!token) {
    return <InvalidLink />;
  }

  const booking = await getBookingByTitleToken(id, token);
  if (!booking) {
    return <InvalidLink />;
  }

  const times = generateTimeOptions();
  const timeErrorMessage = timeError ? TIME_ERROR_MESSAGES[timeError] : undefined;

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16">
      <h1 className="text-xl font-bold mb-2">予約の管理</h1>
      <p className="text-gray-600 mb-1">
        {formatJapaneseDate(booking.date)} {booking.startTime}〜{booking.endTime}
      </p>
      {booking.title && <p className="text-gray-600 mb-6">予定名: {booking.title}</p>}

      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">予定名の公開設定</h2>
        {booking.title ? (
          <>
            <p
              className={`mb-3 text-sm rounded border px-3 py-2 ${
                booking.titlePublicAllowed
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-gray-50 text-gray-600"
              }`}
            >
              現在の設定: {booking.titlePublicAllowed ? "この予定名は公開されています" : "この予定名は非公開です"}
            </p>
            <form action={updateMyTitlePublicAllowed.bind(null, id)}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="allowed" value={(!booking.titlePublicAllowed).toString()} />
              <button
                type="submit"
                className="w-full bg-blue-600 text-white rounded px-4 py-2.5 font-medium hover:bg-blue-700 transition"
              >
                {booking.titlePublicAllowed ? "予定名を非公開にする" : "予定名を公開する"}
              </button>
            </form>
            <p className="text-xs text-gray-400 mt-2">
              この設定はご本人だけが変更できます。管理者が代わりに公開へ変更することはありません。
            </p>
          </>
        ) : (
          <p className="text-gray-400 text-sm">
            予定名が入力されていないため、公開設定はありません。
          </p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">予約時間を変更する</h2>

        {timeUpdated && (
          <p className="mb-3 text-sm rounded border border-green-200 bg-green-50 text-green-700 px-3 py-2">
            変更を受け付けました。管理者の再承認をお待ちください。
          </p>
        )}
        {timeErrorMessage && (
          <p className="mb-3 text-sm rounded border border-red-200 bg-red-50 text-red-700 px-3 py-2">
            {timeErrorMessage}
          </p>
        )}

        {booking.status === "approved" ? (
          <>
            <p className="text-xs text-gray-500 mb-3">
              延長・短縮のどちらも可能です。変更すると一度「承認待ち」に戻り、管理者の再承認が必要になります（再承認・却下のいずれもメールで管理者に通知されます）。
            </p>
            <form action={requestTimeChange.bind(null, id)} className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="newStartTime" className="block text-xs text-gray-500 mb-1">
                    新しい開始時刻
                  </label>
                  <select
                    id="newStartTime"
                    name="newStartTime"
                    required
                    defaultValue={booking.startTime}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  >
                    {times.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="newEndTime" className="block text-xs text-gray-500 mb-1">
                    新しい終了時刻
                  </label>
                  <select
                    id="newEndTime"
                    name="newEndTime"
                    required
                    defaultValue={booking.endTime}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  >
                    {times.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="submit"
                className="w-full bg-gray-900 text-white rounded px-4 py-2.5 font-medium hover:bg-gray-800 transition"
              >
                この時間に変更を申請する
              </button>
            </form>
          </>
        ) : (
          <p className="text-gray-400 text-sm">
            {STATUS_NOTES[booking.status] ?? "現在、時間の変更はできません。"}
          </p>
        )}
      </section>
    </main>
  );
}
