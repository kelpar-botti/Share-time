import Link from "next/link";
import { redirect } from "next/navigation";
import { submitBookingRequest } from "@/lib/actions";
import { getBookingsVisibleOnDate } from "@/lib/bookings";
import { formatJapaneseDate, generateTimeOptions, isValidDateString } from "@/lib/date";

type Props = {
  searchParams: Promise<{ date?: string; start?: string; end?: string; error?: string }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  missing: "お名前と内容は必須です。入力をご確認ください。",
  email: "メールアドレスの形式が正しくありません。",
  range: "開始時刻と終了時刻が同じです。時間を変えてください。",
  taken: "その時間帯は他の予約と重なっています。別の時間をお選びください。",
};

export default async function BookPage({ searchParams }: Props) {
  const { date, start, end, error } = await searchParams;

  if (!isValidDateString(date)) {
    redirect("/");
  }

  const times = generateTimeOptions();
  const visible = await getBookingsVisibleOnDate(date);
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <Link href={`/day?date=${date}`} className="text-sm text-blue-600 hover:underline">
        ← 予約状況に戻る
      </Link>
      <h1 className="text-xl font-bold mt-3 mb-1">予約を申請する</h1>
      <p className="text-gray-600 mb-1">{formatJapaneseDate(date)}</p>
      <p className="text-xs text-gray-400 mb-6">
        24時間いつでも申請できます。日をまたぐ場合は、終了時刻に開始時刻より早い時間（翌日分）を選んでください（例:
        22:00〜02:00）。
      </p>

      {visible.length > 0 && (
        <div className="mb-4 text-sm text-gray-500 rounded border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="mb-1">既に予約が入っている時間帯:</p>
          <ul className="list-disc list-inside">
            {visible.map((b) => (
              <li key={b.id}>
                {b.carriesFromPreviousDay ? "00:00" : b.startTime}〜{b.endTime}
                {b.spillsIntoNextDay && !b.carriesFromPreviousDay && "（翌日まで）"}
                {b.carriesFromPreviousDay && "（前日から）"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {errorMessage && (
        <p className="mb-4 rounded bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
          {errorMessage}
        </p>
      )}

      <form action={submitBookingRequest} className="space-y-4">
        <input type="hidden" name="date" value={date} />
        {/* Honeypot: hidden from real users, some bots fill every field. */}
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          className="hidden"
          aria-hidden="true"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="startTime" className="block text-sm font-medium mb-1">
              開始時刻
            </label>
            <select
              id="startTime"
              name="startTime"
              required
              defaultValue={start ?? ""}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="" disabled>
                選択してください
              </option>
              {times.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="endTime" className="block text-sm font-medium mb-1">
              終了時刻
            </label>
            <select
              id="endTime"
              name="endTime"
              required
              defaultValue={end ?? ""}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="" disabled>
                選択してください
              </option>
              {times.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-1">
            お名前
          </label>
          <input
            id="name"
            name="name"
            required
            maxLength={100}
            className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            メールアドレス（任意）
          </label>
          <input
            id="email"
            type="email"
            name="email"
            maxLength={200}
            className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <p className="text-xs text-gray-400 mt-1">
            記載いただくと、確定・見送りの結果をメールでお知らせします。
          </p>
        </div>
        <div>
          <label htmlFor="message" className="block text-sm font-medium mb-1">
            内容・ご要望
          </label>
          <p className="text-xs text-gray-500 mb-1">
            どのようなご用件か、当日までにご用意いただきたいものや、その他ご要望があれば、できるだけ詳しくご記入ください。文字数の制限はありません。
          </p>
          <textarea
            id="message"
            name="message"
            required
            rows={6}
            placeholder="例: 〇〇についてご相談したいです。当日は△△をご用意いただけますと助かります。"
            className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <button
          type="submit"
          className="w-full bg-blue-600 text-white rounded px-4 py-2.5 font-medium hover:bg-blue-700 transition"
        >
          この内容で申請する
        </button>
      </form>
    </main>
  );
}
