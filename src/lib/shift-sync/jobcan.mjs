import { load } from 'cheerio';

const ORIGIN = 'https://ssl.jobcan.jp';
const MONTH_PATH = '/m/shift-pattern-request/shiftdefinition';
const DETAIL_PATH = '/m/shift-pattern-request/request';

export class JobcanError extends Error {
  constructor(code, message) { super(message); this.name = 'JobcanError'; this.code = code; }
}
function fail(code, message) { throw new JobcanError(code, message); }
function text(value) { return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim(); }
function monthParts(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('JOBCAN_PARSE', '対象月が不正です。');
  const [year, number] = month.split('-').map(Number);
  if (year < 2000 || year > 2099) fail('JOBCAN_PARSE', '対象年が不正です。');
  return { year, number, length: new Date(Date.UTC(year, number, 0)).getUTCDate() };
}
function safeUrl(value, base = ORIGIN) {
  let url;
  try { url = new URL(value, base); } catch { fail('JOBCAN_PARSE', 'ページのURLを確認できません。'); }
  if (url.origin !== ORIGIN || url.username || url.password || url.hash) fail('JOBCAN_NETWORK', 'ジョブカン以外への転送を拒否しました。');
  return url;
}

export function normalizeTimeRange(start, end) {
  const parse = value => {
    const match = text(value).match(/^(\d{1,2}):([0-5]\d)$/);
    if (!match || Number(match[1]) > 47) fail('JOBCAN_PARSE', 'シフト時刻を確認できません。');
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const from = parse(start);
  let to = parse(end);
  if (from >= 1440) fail('JOBCAN_PARSE', '開始日を確認できないシフトです。');
  if (to <= from) to += 1440;
  if (to - from <= 0 || to - from >= 1440) fail('JOBCAN_PARSE', '24時間以上のシフトには対応していません。');
  const format = value => `${String(Math.floor(value / 60) % 24).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  return { startTime: format(from), endTime: format(to) };
}

function extractRanges(value) {
  const normalized = text(value);
  const pattern = /(?<![\d:])(\d{1,3}:\d{1,3})\s*(?:~|〜|～|−|–|—|-)\s*(\d{1,3}:\d{1,3})(?![\d:])/g;
  const matches = [...normalized.matchAll(pattern)];
  const remaining = normalized.replace(pattern, '');
  if (/\d+:\d+\s*(?:~|〜|～|−|–|—|-)|(?:~|〜|～|−|–|—|-)\s*\d+:\d+/.test(remaining)) {
    fail('JOBCAN_PARSE', 'シフト時刻の形式を確認できません。');
  }
  return matches.map(match => normalizeTimeRange(match[1], match[2]));
}
function page(html) {
  const $ = load(html);
  if ($('input[type="password"]').length || /ログイン\s*[|｜]|マイページログイン/.test($('title').text())) {
    fail('JOBCAN_LOGIN', 'ジョブカンへのログインに失敗しました。モバイル用の設定を確認してください。');
  }
  $('script,style,noscript').remove();
  return $;
}
function rejectUnpublished(value) {
  if (/未公開|未確定|申請中|調整中/.test(value)) fail('JOBCAN_INCOMPLETE', '未公開または未確定のシフトが含まれています。');
}

/** Matches the observed mobile page's own confirmed section, excluding applications and coworkers. */
export function parseDayDetail(html, date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('JOBCAN_PARSE', '対象日が不正です。');
  const { year, number, length } = monthParts(date.slice(0, 7));
  const day = Number(date.slice(8));
  if (day < 1 || day > length) fail('JOBCAN_PARSE', '対象日が不正です。');
  const $ = page(html);
  const dates = $('table.data03 th').toArray().map(el => text($(el).text()))
    .filter(value => /^\d{4}年\s*\d{1,2}月\s*\d{1,2}日$/.test(value));
  if (dates.length !== 1) fail('JOBCAN_PARSE', `${date}の表示日を確認できません。`);
  const match = dates[0].match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日$/);
  if (Number(match[1]) !== year || Number(match[2]) !== number || Number(match[3]) !== day) {
    fail('JOBCAN_PARSE', `${date}とは異なる日付のページです。`);
  }
  const table = $('table.section_title');
  if (table.length !== 1) fail('JOBCAN_PARSE', '本人の確定シフト欄を確認できません。');
  const rows = table.children('tbody').children('tr').toArray();
  const heading = row => {
    const nested = $(row).children('td').children('table').first();
    return text(nested.children('tbody').children('tr').first().children('td').first().text());
  };
  const confirmed = rows.map((row, index) => heading(row) === '確定シフト' ? index : -1).filter(index => index >= 0);
  const requested = rows.map((row, index) => heading(row) === '申請シフト' ? index : -1).filter(index => index >= 0);
  if (confirmed.length !== 1 || requested.length !== 1 || requested[0] !== confirmed[0] + 2) {
    fail('JOBCAN_PARSE', '本人の確定シフト欄の構造を確認できません。');
  }
  const valueRow = $(rows[confirmed[0] + 1]);
  if (valueRow.children('td').length !== 1 || valueRow.find('table').length) fail('JOBCAN_PARSE', '確定シフトの内容を確認できません。');
  const content = text(valueRow.children('td').text());
  rejectUnpublished(content);
  if (content === '-') return null;
  const ranges = extractRanges(content);
  const unique = new Map(ranges.map(range => [`${range.startTime}_${range.endTime}`, range]));
  if (unique.size !== 1) fail('JOBCAN_PARSE', `${date}のシフト開始・終了時刻を一意に確認できません。`);
  return { date, ...[...unique.values()][0] };
}

/** All actual-month cells must contain a verified literal link, including blank cells. Never executes onclick. */
export function parseMonthListing(html, month, currentUrl) {
  const { year, number, length } = monthParts(month);
  const url = safeUrl(currentUrl);
  if (url.pathname !== `${MONTH_PATH}/year/${year}/month/${number}` || url.search) {
    fail('JOBCAN_PARSE', '要求した月の確定シフトページではありません。');
  }
  const $ = page(html);
  if ($('.title2').length !== 1 || text($('.title2').text()) !== '確定シフト') fail('JOBCAN_PARSE', '確定シフトの見出しがありません。');
  const tab = $('table.table-tab-jbc td.shift-left.active');
  if (tab.length !== 1 || text(tab.text()) !== '確定シフト' || tab.find('a').length !== 1) fail('JOBCAN_PARSE', '確定シフトタブを確認できません。');
  const tabUrl = safeUrl(tab.find('a').attr('href'), currentUrl);
  if (tabUrl.pathname !== MONTH_PATH || tabUrl.search) fail('JOBCAN_PARSE', '確定シフトタブのリンクが不正です。');
  const navMonths = $('table.data03').toArray().flatMap(el => [...text($(el).text()).matchAll(/(\d{4})年\s*(\d{1,2})月度/g)]);
  if (navMonths.length !== 1 || Number(navMonths[0][1]) !== year || Number(navMonths[0][2]) !== number) fail('JOBCAN_PARSE', '表示月が対象月と一致しません。');
  if ($('table#calendar').length !== 1) fail('JOBCAN_PARSE', '確定シフトのカレンダーを確認できません。');
  const rows = new Map();
  $('table#calendar').children('tbody').children('tr').children('td').each((_, el) => {
    const cell = $(el);
    if (cell.hasClass('gray')) return;
    const literal = cell.attr('onclick')?.match(/^\s*location\.href\s*=\s*(['"])([^'"]+)\1\s*;?\s*$/);
    if (!literal) fail('JOBCAN_PARSE', '日付の詳細リンクを確認できません。');
    const detail = safeUrl(literal[2], currentUrl);
    const keys = [...detail.searchParams.keys()];
    if (detail.pathname !== DETAIL_PATH || keys.length !== 4 || new Set(keys).size !== 4 ||
        !['year','month','day','_m'].every(key => detail.searchParams.has(key)) ||
        detail.searchParams.get('year') !== String(year) || detail.searchParams.get('month') !== String(number) ||
        detail.searchParams.get('_m') !== 'def') fail('JOBCAN_PARSE', '確定シフトの日付リンクが不正です。');
    const dayValue = detail.searchParams.get('day');
    if (!/^\d{2}$/.test(dayValue)) fail('JOBCAN_PARSE', '日付リンクの日を確認できません。');
    const day = Number(dayValue);
    const copy = cell.clone();
    copy.children('p').remove();
    if (day < 1 || day > length || text(copy.text()) !== String(day)) fail('JOBCAN_PARSE', '日付の表示とリンクが一致しません。');
    rejectUnpublished(text(cell.find('p').text()));
    if (rows.has(day)) fail('JOBCAN_PARSE', '日付が重複しています。');
    rows.set(day, { date: `${month}-${dayValue}`, detailUrl: detail.href });
  });
  if (rows.size !== length) fail('JOBCAN_INCOMPLETE', '一か月分の全日付を取得できませんでした。');
  return { month, rows: [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

/** The user reserves nine hours from each confirmed start, independent of actual shift end. */
export function reserveNineHours(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.shifts)) fail('JOBCAN_PARSE', '勤務一覧を確認できません。');
  return { ...snapshot, shifts: snapshot.shifts.map(shift => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(shift.startTime)) fail('JOBCAN_PARSE', '確定シフトの開始時刻が不正です。');
    const [hour, minute] = shift.startTime.split(':').map(Number);
    const end = (hour * 60 + minute + 540) % 1440;
    return { ...shift, endTime: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}` };
  }) };
}

class JobcanSession {
  constructor(fetchImpl) { this.fetch = fetchImpl; this.cookies = new Map(); this.deadline = Date.now() + 45_000; }
  async request(input, options = {}) {
    let url = safeUrl(input);
    let method = options.method ?? 'GET';
    let body = options.body;
    for (let redirect = 0; redirect < 6; redirect++) {
      const remaining = this.deadline - Date.now();
      if (remaining <= 0) fail('JOBCAN_TIMEOUT', 'ジョブカンの取得が時間切れになりました。');
      let response, html;
      try {
        response = await this.fetch(url.href, {
          method, body, redirect: 'manual',
          headers: { 'user-agent': 'ShareTime-ShiftSync/1.0', ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
            ...(this.cookies.size ? { cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ') } : {}) },
          signal: AbortSignal.timeout(Math.min(8_000, remaining)),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const first = cookie.split(';')[0];
          const index = first.indexOf('=');
          if (index > 0) this.cookies.set(first.slice(0, index), first.slice(index + 1));
        }
        if ([301,302,303,307,308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) fail('JOBCAN_NETWORK', '転送先を確認できません。');
          url = safeUrl(location, url);
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
          await response.body?.cancel();
          continue;
        }
        if (!response.ok) fail('JOBCAN_NETWORK', 'ジョブカンが応答できませんでした。');
        html = await response.text();
      } catch (error) {
        if (error instanceof JobcanError) throw error;
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') fail('JOBCAN_TIMEOUT', 'ジョブカンの取得が時間切れになりました。');
        fail('JOBCAN_NETWORK', 'ジョブカンとの通信に失敗しました。');
      }
      if (Date.now() > this.deadline) fail('JOBCAN_TIMEOUT', 'ジョブカンの取得が時間切れになりました。');
      if (html.length > 2_000_000) fail('JOBCAN_PARSE', 'ページが大きすぎるため処理を停止しました。');
      return { html, url: url.href };
    }
    fail('JOBCAN_NETWORK', '転送が繰り返されました。');
  }
}

export async function fetchConfirmedMonth(month, { clientId, email, password, expectedStaffCode, fetchImpl = fetch } = {}) {
  const { year, number } = monthParts(month); // Validate before transmitting credentials.
  if (!clientId || !email || !password) fail('JOBCAN_CONFIG', 'ジョブカンのモバイルログイン設定が必要です。');
  if (expectedStaffCode != null && !/^\d+$/.test(String(expectedStaffCode))) fail('JOBCAN_CONFIG', '本人確認用スタッフコードが不正です。');
  const session = new JobcanSession(fetchImpl);
  const initial = await session.request(`/login/mb-employee?client_id=${encodeURIComponent(clientId)}&lang_code=ja`);
  const $ = load(initial.html);
  const form = $('form').filter((_, el) => $(el).find('input[name="password"]').length > 0);
  if (form.length !== 1 || form.attr('method')?.toLowerCase() !== 'post') fail('JOBCAN_PARSE', '正規のログインフォームがありません。');
  const fields = new URLSearchParams();
  form.find('input[name]').each((_, el) => {
    const input = $(el);
    if (input.attr('type') !== 'checkbox') fields.set(input.attr('name'), input.attr('value') ?? '');
  });
  fields.set('client_id', clientId); fields.set('email', email); fields.set('password', password);
  const action = safeUrl(form.attr('action'), initial.url);
  if (!action.pathname.startsWith('/login/')) fail('JOBCAN_NETWORK', 'ログイン先が不正です。');
  const login = await session.request(action.href, { method: 'POST', body: fields.toString() });
  const landing = page(login.html); // Never save credentials or session cookies.
  if (expectedStaffCode != null) {
    const codes = [...text(landing('body').text()).matchAll(/スタッフコード\s*\(([^)]+)\)/g)].map(match => text(match[1]));
    if (codes.length !== 1 || codes[0] !== String(expectedStaffCode)) fail('JOBCAN_IDENTITY', 'ログインしたスタッフが登録対象の本人と一致しません。');
  }
  const listing = await session.request(`${MONTH_PATH}/year/${year}/month/${number}`);
  const parsed = parseMonthListing(listing.html, month, listing.url);
  const shifts = [];
  for (const row of parsed.rows) {
    const detail = await session.request(row.detailUrl);
    if (detail.url !== row.detailUrl) fail('JOBCAN_PARSE', '要求した日付の詳細ページではありません。');
    const shift = parseDayDetail(detail.html, row.date);
    if (shift) shifts.push(shift);
  }
  return reserveNineHours({ month, complete: true, coveredDates: parsed.rows.map(row => row.date), shifts });
}
