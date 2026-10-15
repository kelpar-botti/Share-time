import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTimeRange, parseDayDetail, parseMonthListing, fetchConfirmedMonth, reserveNineHours, validateDayDetailUrl, JobcanError } from '../src/lib/shift-sync/jobcan.mjs';

const url = 'https://ssl.jobcan.jp/m/shift-pattern-request/shiftdefinition/year/2026/month/10';
const dayPath = day => `/m/shift-pattern-request/request?year=2026&month=10&day=${String(day).padStart(2,'0')}&_m=def`;
// The fixtures below model the authenticated DOM observed on the user's mobile page.
function cellHtml(day, { content = day === 15 ? 'ア)早番<br>09:30' : '', link = dayPath(day), onclick } = {}) {
  return `<td onclick="${onclick ?? `location.href='${link}';`}">${day}<p>${content}</p></td>`;
}
function monthHtml({ missing = 0, cells, nav = '2026年10月度', content } = {}) {
  const dates = cells ?? Array.from({length:31}, (_, i) => i + 1).filter(day => day !== missing)
    .map(day => cellHtml(day, content === undefined ? {} : { content }));
  const padded = ['<td class="gray prefixprevmonth">30</td>', ...dates, '<td class="gray prefixnextmonth">1</td>'];
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(`<tr>${padded.slice(i,i+7).join('')}</tr>`);
  return `<div class="title2">確定シフト</div>
    <table class="table-tab-jbc"><tr><td class="shift-left active"><a href="/m/shift-pattern-request/shiftdefinition">確定シフト</a></td><td>シフト申請</td></tr></table>
    <table class="data03"><tr><td>前月へ</td><th>${nav}</th><td>翌月へ</td></tr></table>
    <table id="calendar"><tbody>${weeks.join('')}</tbody></table><div>シフト合計時間 : 172:00</div>`;
}
function detailHtml({ day = 15, confirmed = 'アルバイト）早番(9:30～18:30） (9:30～18:30)<br>', requested = '遅番(15:00～21:00)', extraConfirmed = '' } = {}) {
  return `<div class="title2">シフト申請</div><table class="data03"><tr><td>前日へ</td><th>2026年10月${String(day).padStart(2,'0')}日</th><td>翌日へ</td></tr></table>
  <table class="section_title"><tbody>
    <tr><td><table><tr><td>確定シフト</td><td><input type="submit" value="確定一覧"></td></tr></table></td></tr>
    <tr><td>${confirmed}</td></tr>${extraConfirmed}
    <tr><td><table><tr><td>申請シフト</td><td><input type="submit" value="申請一覧"></td></tr></table></td></tr>
    <tr><td>${requested}</td></tr>
    <tr><td>他スタッフの確定シフト</td></tr>
    <tr><td>他スタッフA(5:00～14:00)<br>他スタッフB(21:00～30:00)</td></tr>
  </tbody></table>`;
}
const config = { clientId:'test', email:'x@example.test', password:'test', expectedStaffCode:'11924' };
const loginHtml = '<form method="post" action="/login/mb-employee"><input name="token" value="test-token"><input name="client_id"><input name="email"><input name="password" type="password"></form>';
function fakeSession({ staffCode = '11924', allOff = false, badDay = 0, detailRedirect } = {}) {
  const calls = [];
  const redirectedDays = new Set();
  const fetchImpl = async (input, options) => {
    calls.push({input,options});
    const parsed = new URL(input);
    if (parsed.pathname.startsWith('/login/') && options.method === 'GET') return new Response(loginHtml);
    if (parsed.pathname.startsWith('/login/') && options.method === 'POST') return new Response(`スタッフコード (${staffCode})`);
    if (parsed.pathname.includes('/shiftdefinition/')) return new Response(monthHtml({ content: '' }));
    if (parsed.pathname === '/m/shift-pattern-request/request') {
      const day = Number(parsed.searchParams.get('day'));
      if (detailRedirect && !redirectedDays.has(day)) {
        redirectedDays.add(day);
        return new Response('', {status:302,headers:{location:detailRedirect(day)}});
      }
      if (day === badDay) return new Response(detailHtml({day, confirmed:'調整中'}));
      return new Response(detailHtml({day,confirmed: day === 15 && !allOff ? '短時間(10:00～14:30)' : '-'}));
    }
    throw new Error('Unexpected request');
  };
  return { fetchImpl, calls };
}

test('normalize actual midnight ranges and reject malformed or day-long ranges', () => {
  assert.deepEqual(normalizeTimeRange('22:00','26:30'), {startTime:'22:00',endTime:'02:30'});
  assert.deepEqual(normalizeTimeRange('10:00','24:00'), {startTime:'10:00',endTime:'00:00'});
  for (const range of [['10:00','34:00'],['24:00','26:00'],['10:99','19:00'],['00:00','00:00']]) assert.throws(() => normalizeTimeRange(...range));
});
test('actual month grid returns all dates and observed detail URLs, including blank cells', () => {
  const parsed = parseMonthListing(monthHtml(), '2026-10', url);
  assert.equal(parsed.rows.length, 31);
  assert.deepEqual(parsed.rows[0], {date:'2026-10-01',detailUrl:`https://ssl.jobcan.jp${dayPath(1)}`});
  assert.deepEqual(parsed.rows[14], {date:'2026-10-15',detailUrl:`https://ssl.jobcan.jp${dayPath(15)}`});
  assert.equal(parsed.rows[30].date,'2026-10-31');
});
test('nested data03 wrappers may expose the same month heading more than once', () => {
  const html = `<table class="data03"><tr><td>${monthHtml()}</td></tr></table>`;
  const parsed = parseMonthListing(html,'2026-10',url);
  assert.equal(parsed.rows.length,31);
});
test('repeated matching navigation headings are accepted but missing or mixed months fail closed', () => {
  const same = `${monthHtml()}<table class="data03"><tr><th>2026年10月度</th></tr></table>`;
  assert.equal(parseMonthListing(same,'2026-10',url).rows.length,31);
  const mixed = `${monthHtml()}<table class="data03"><tr><th>2026年09月度</th></tr></table>`;
  assert.throws(() => parseMonthListing(mixed,'2026-10',url),{code:'JOBCAN_PARSE',reason:'MONTH_NAV_MISMATCH'});
  assert.throws(() => parseMonthListing(monthHtml({nav:'不明'}),'2026-10',url),{code:'JOBCAN_PARSE',reason:'MONTH_NAV_MISSING'});
});
test('wrong URL month, URL suffix, navigation month, missing date, duplicate date and login fail closed', () => {
  const duplicate = Array.from({length:31},(_,i) => cellHtml(i+1));
  duplicate[30] = cellHtml(30);
  const cases = [
    () => parseMonthListing(monthHtml(), '2026-11', url),
    () => parseMonthListing(monthHtml(), '2026-10', `${url}/extra`),
    () => parseMonthListing(monthHtml({nav:'2026年09月度'}), '2026-10', url),
    () => parseMonthListing(monthHtml({missing:31}), '2026-10', url),
    () => parseMonthListing(monthHtml({cells:duplicate}), '2026-10', url),
    () => parseMonthListing('<input type="password">','2026-10',url),
    () => parseMonthListing(monthHtml({content:'調整中'}),'2026-10',url),
    () => parseMonthListing(monthHtml().replace('shift-left active','shift-left'),'2026-10',url),
  ];
  for (const fn of cases) assert.throws(fn);
});
test('onclick is parsed as a literal URL, never evaluated, and rejects untrusted paths or queries', () => {
  const replacements = [
    cellHtml(1, {onclick:`location.href='${dayPath(1)}'; globalThis.jobcanExecuted = true;`}),
    cellHtml(1, {link:`https://example.org${dayPath(1)}`}),
    cellHtml(1, {link:dayPath(1).replace('/request?','/shiftdefinition?')}),
    cellHtml(1, {link:dayPath(1).replace('_m=def','_m=req')}),
    cellHtml(1, {link:dayPath(2)}),
    cellHtml(1, {link:`${dayPath(1)}&year=2026`}),
    cellHtml(1, {link:dayPath(1).replace('year=2026','year=2025')}),
    cellHtml(1, {link:dayPath(1).replace('month=10','month=11')}),
  ];
  for (const replacement of replacements) {
    const cells = [replacement, ...Array.from({length:30},(_,i) => cellHtml(i+2))];
    assert.throws(() => parseMonthListing(monthHtml({cells}),'2026-10',url));
  }
  assert.equal(globalThis.jobcanExecuted,undefined);
});
test('detail uses only own confirmed row and deduplicates the repeated pattern range', () => {
  assert.deepEqual(parseDayDetail(detailHtml(),'2026-10-15'), {date:'2026-10-15',startTime:'09:30',endTime:'18:30'});
  assert.deepEqual(parseDayDetail(detailHtml({confirmed:'夜番(20:00～29:00)'}),'2026-10-15'), {date:'2026-10-15',startTime:'20:00',endTime:'05:00'});
});
test('explicit absence returns null even when application and coworkers contain work hours', () => {
  assert.equal(parseDayDetail(detailHtml({day:16,confirmed:'-'}),'2026-10-16'),null);
});
test('detail rejects date mismatch, missing section, extra rows, unpublished, malformed and distinct ranges', () => {
  const cases = [
    detailHtml({day:16}),
    detailHtml().replace('確定シフト</td>','勤務実績</td>'),
    detailHtml({confirmed:''}),
    detailHtml({confirmed:'調整中'}),
    detailHtml({confirmed:'10:00～12:00、14:00～18:00'}),
    detailHtml({confirmed:'10:00～19:00 10:99～19:00'}),
    detailHtml({confirmed:'10:00～19:00 10:00～不明'}),
    detailHtml({extraConfirmed:'<tr><td>別の時間 00:00～08:00</td></tr>'}),
  ];
  for (const html of cases) assert.throws(() => parseDayDetail(html,'2026-10-15'));
  assert.throws(() => parseDayDetail('<body>確定シフト 10:00～19:00</body>','2026-10-15'));
});
test('calendar reserves nine hours from confirmed start even for shorter actual shifts or overnight starts', () => {
  const snapshot = {month:'2026-10',complete:true,coveredDates:['2026-10-15','2026-10-16'],shifts:[
    {date:'2026-10-15',startTime:'10:00',endTime:'14:30'},
    {date:'2026-10-16',startTime:'20:00',endTime:'23:00'},
  ]};
  const mapped = reserveNineHours(snapshot);
  assert.deepEqual(mapped.shifts.map(shift => shift.endTime),['19:00','05:00']);
  assert.equal(snapshot.shifts[0].endTime,'14:30');
  assert.deepEqual(mapped.coveredDates,snapshot.coveredDates);
  assert.throws(() => reserveNineHours({shifts:[{startTime:'25:00'}]}));
});
test('HTTP month fetch checks identity, reads blank days, preserves coverage and returns nine-hour slots', async () => {
  const fake = fakeSession();
  const snapshot = await fetchConfirmedMonth('2026-10',{...config,fetchImpl:fake.fetchImpl});
  assert.equal(fake.calls.length,34); // login GET + POST + listing + every day.
  assert.equal(snapshot.coveredDates.length,31);
  assert.deepEqual(snapshot.shifts,[{date:'2026-10-15',startTime:'10:00',endTime:'19:00'}]);
  const post = new URLSearchParams(fake.calls[1].options.body);
  assert.equal(post.get('token'),'test-token');
  assert.equal(post.get('password'),'test');
  assert.equal(fake.calls[3].options.method,'GET');
});
test('invalid month is rejected before credentials are sent', async () => {
  let count = 0;
  await assert.rejects(fetchConfirmedMonth('2026-13',{...config,fetchImpl:async () => {count++;throw new Error('called');}}),{code:'JOBCAN_PARSE'});
  assert.equal(count,0);
});
test('staff mismatch stops before schedule reads', async () => {
  const fake = fakeSession({staffCode:'99999'});
  await assert.rejects(fetchConfirmedMonth('2026-10',{...config,fetchImpl:fake.fetchImpl}),{code:'JOBCAN_IDENTITY'});
  assert.equal(fake.calls.length,2);
});
test('one unpublished detail prevents a complete snapshot', async () => {
  const fake = fakeSession({badDay:31});
  await assert.rejects(fetchConfirmedMonth('2026-10',{...config,fetchImpl:fake.fetchImpl}),{code:'JOBCAN_INCOMPLETE'});
  assert.equal(fake.calls.length,34);
});
test('all-off month is complete only after every day explicitly confirms absence', async () => {
  const fake = fakeSession({allOff:true});
  const snapshot = await fetchConfirmedMonth('2026-10',{...config,fetchImpl:fake.fetchImpl});
  assert.equal(fake.calls.length,34);
  assert.equal(snapshot.complete,true);
  assert.equal(snapshot.coveredDates.length,31);
  assert.equal(snapshot.coveredDates[0],'2026-10-01');
  assert.equal(snapshot.coveredDates[30],'2026-10-31');
  assert.deepEqual(snapshot.shifts,[]);
});
test('login redirects never transmit password or cookies to another origin', async () => {
  let count = 0;
  const fakeFetch = async () => {count++;return new Response('',{status:302,headers:{location:'https://example.org/steal'}});};
  await assert.rejects(fetchConfirmedMonth('2026-10',{...config,fetchImpl:fakeFetch}),{code:'JOBCAN_NETWORK'});
  assert.equal(count,1);
});
test('network errors expose safe codes and never transport exception URLs or secrets', async () => {
  for (const [error,code] of [[new TypeError('private URL and password'), 'JOBCAN_NETWORK'],[new DOMException('private token','TimeoutError'),'JOBCAN_TIMEOUT']]) {
    await assert.rejects(fetchConfirmedMonth('2026-10',{...config,fetchImpl:async () => {throw error;}}), value => value.code === code && !/private|password|token/.test(value.message));
  }
});

test('diagnostic reasons identify failing checks using fixed labels', () => {
  assert.throws(() => parseMonthListing(monthHtml(),'2026-10',`${url}/extra`), {code:'JOBCAN_PARSE',reason:'MONTH_URL'});
  assert.throws(() => parseMonthListing(monthHtml({missing:31}),'2026-10',url), {code:'JOBCAN_INCOMPLETE',reason:'MONTH_COVERAGE'});
  assert.throws(() => parseMonthListing(monthHtml().replace('shift-left active','shift-left'),'2026-10',url), {code:'JOBCAN_PARSE',reason:'MONTH_TAB'});
  assert.throws(() => parseDayDetail(detailHtml({day:16}),'2026-10-15'), {code:'JOBCAN_PARSE',reason:'DETAIL_DATE'});
  assert.throws(() => parseDayDetail(detailHtml({confirmed:''}),'2026-10-15'), {code:'JOBCAN_PARSE',reason:'DETAIL_TIME'});
  assert.throws(() => parseDayDetail(detailHtml().replace('確定シフト</td>','勤務実績</td>'),'2026-10-15'), {code:'JOBCAN_PARSE',reason:'DETAIL_STRUCTURE'});
  assert.equal(new JobcanError('JOBCAN_PARSE','private message','https://private.example/?token=secret').reason,'');
  assert.equal(new JobcanError('JOBCAN_PARSE','private message','SECRETUPPERCASEVALUE').reason,'');
});
test('detail final URLs allow query reordering, optional confirmed marker and numeric date padding', () => {
  const base = 'https://ssl.jobcan.jp/m/shift-pattern-request/request';
  for (const query of ['year=2026&month=10&day=01&_m=def','day=1&month=10&year=2026','_m=def&day=01&year=2026&month=10']) {
    assert.equal(validateDayDetailUrl(`${base}?${query}`,'2026-10-01').origin,'https://ssl.jobcan.jp');
  }
});
test('detail final URLs reject other dates, origins, paths, duplicate keys, unknown query or application marker', () => {
  const base = 'https://ssl.jobcan.jp/m/shift-pattern-request/request';
  const urls = [
    `${base}?year=2026&month=10&day=2`,
    `${base}?year=2026&month=11&day=1`,
    `${base}?year=2025&month=10&day=1`,
    `${base}?year=2026&month=10&day=1&_m=req`,
    `${base}?year=2026&month=10&day=1&extra=true`,
    `${base}?year=2026&month=10&day=1&day=01`,
    `${base}?year=2026&month=10&day=1#fragment`,
    `${base}/other?year=2026&month=10&day=1`,
    `${base.replace('ssl.jobcan.jp','example.org')}?year=2026&month=10&day=1`,
  ];
  for (const value of urls) assert.throws(() => validateDayDetailUrl(value,'2026-10-01'), {reason:'DETAIL_URL'});
});
test('HTTP fetch accepts observed detail redirects while retaining day and own-section validation', async () => {
  const fake = fakeSession({detailRedirect:day => `/m/shift-pattern-request/request?day=${day}&month=10&year=2026`});
  const snapshot = await fetchConfirmedMonth('2026-10',{...config,fetchImpl:fake.fetchImpl});
  assert.equal(fake.calls.length,65);
  assert.equal(snapshot.coveredDates.length,31);
  assert.deepEqual(snapshot.shifts,[{date:'2026-10-15',startTime:'10:00',endTime:'19:00'}]);
});
test('malformed public login forms report LOGIN_FORM before any POST', async () => {
  let calls = 0;
  await assert.rejects(fetchConfirmedMonth('2026-10',{...config,fetchImpl:async () => {calls++;return new Response('<form></form>');}}),{code:'JOBCAN_PARSE',reason:'LOGIN_FORM'});
  assert.equal(calls,1);
});
