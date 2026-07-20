import Link from "next/link";
import { getBookingByTitleToken } from "@/lib/bookings";
import { updateMyTitlePublicAllowed } from "@/lib/actions";
import { formatJapaneseDate } from "@/lib/date";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
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

export default async function TitleVisibilityPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { token } = await searchParams;

  if (!token) {
    return <InvalidLink />;
  }

  const booking = await getBookingByTitleToken(id, token);
  if (!booking) {
    return <InvalidLink />;
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16">
      <h1 className="text-xl font-bold mb-2">予定名の公開設定</h1>
      <p className="text-gray-600 mb-1">
        {formatJapaneseDate(booking.date)} {booking.startTime}〜{booking.endTime}
      </p>
      {booking.title ? (
        <p className="text-gray-600 mb-6">予定名: {booking.title}</p>
      ) : (
        <p className="text-gray-400 text-sm mb-6">
          予定名が入力されていません。公開できる内容がないため、設定を変更しても表示されるものはありません。
        </p>
      )}

      <p
        className={`mb-6 text-sm rounded border px-3 py-2 ${
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

      <p className="text-xs text-gray-400 mt-4">
        この設定はご本人だけが変更できます。管理者がこの設定を代わりに公開へ変更することはありません。
      </p>
    </main>
  );
}
