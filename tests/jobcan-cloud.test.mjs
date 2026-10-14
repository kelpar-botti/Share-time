import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../integrations/jobcan-gmail/Code.gs', import.meta.url), 'utf8');
const currentTime = Date.parse('2026-10-15T09:00:00+09:00');
const endpoint = 'https://share-time-lyart.vercel.app/api/integrations/jobcan';
const applicationToken = 'test-only-token-with-over-32-characters';
const oauthToken = 'mock-gmail-oauth-do-not-log';

function confirmation(id, sentAt = 'Sun, 27 Sep 2026 12:00:00 +0900', overrides = {}) {
  return {
    id, internalDate: String(Date.parse(sentAt)),
    payload: { headers: [
      { name: 'From', value: 'ジョブカン <noreply@donuts.ne.jp>' },
      { name: 'Subject', value: '来月シフト確定のお知らせ（じゃんぱら）' },
      { name: 'Date', value: sentAt },
    ] }, ...overrides,
  };
}

function harness({ messages = [], locked = false, endpointReply, fetchError, extraProperties = {}, now = currentTime } = {}) {
  const saved = {
    SHARE_TIME_SYNC_URL: endpoint, SHARE_TIME_SYNC_TOKEN: applicationToken, ...extraProperties,
  };
  const calls = [];
  const logs = [];
  const triggers = [];
  let lockReleases = 0;
  let createdCount = 0;
  class FrozenDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const properties = {
    getProperty(key) { return saved[key] ?? null; },
    setProperty(key, value) { saved[key] = value; },
    getProperties() { return { ...saved }; },
    deleteProperty(key) { delete saved[key]; },
  };
  const response = (code, data) => ({
    getResponseCode: () => code,
    getContentText: () => typeof data === 'string' ? data : JSON.stringify(data),
  });
  function trigger(handler) {
    return { handler, getHandlerFunction() { return this.handler; } };
  }
  const context = vm.createContext({
    Date: FrozenDate,
    console: {
      log(value) { assert.equal(typeof value, 'string'); logs.push(value); },
      error() { assert.fail('exceptions must never be logged'); },
      warn() { assert.fail('diagnostics must never be logged'); },
    },
    PropertiesService: { getScriptProperties: () => properties },
    LockService: { getScriptLock: () => ({ tryLock: () => !locked, releaseLock() { lockReleases++; } }) },
    Utilities: {
      base64Decode(text) { return [...Buffer.from(text, 'base64')]; },
      newBlob(bytes) { return { getDataAsString: charset => new TextDecoder(charset).decode(Buffer.from(bytes)) }; },
      formatDate(date, zone, format) {
        assert.equal(zone, 'Asia/Tokyo');
        assert.equal(format, 'yyyy-MM');
        const shifted = new Date(date.getTime() + 9 * 3600000);
        return shifted.toISOString().slice(0, 7);
      },
    },
    ScriptApp: {
      getOAuthToken: () => oauthToken,
      getProjectTriggers: () => [...triggers],
      deleteTrigger(value) { triggers.splice(triggers.indexOf(value), 1); },
      newTrigger(handler) {
        const builder = {
          timeBased() { return this; },
          everyMinutes(value) { assert.equal(value, 5); return this; },
          create() { createdCount++; triggers.push(trigger(handler)); },
        };
        return builder;
      },
    },
    UrlFetchApp: {
      fetch(url, options) {
        calls.push({ url, options });
        if (fetchError) throw new Error(fetchError);
        assert.equal(options.followRedirects, false);
        assert.equal(options.validateHttpsCertificates, true);
        assert.equal(options.muteHttpExceptions, true);
        if (url.startsWith('https://gmail.googleapis.com/')) {
          assert.equal(options.method, 'get');
          assert.equal(options.headers.Authorization, 'Bearer ' + oauthToken);
          const parsed = new URL(url);
          const id = parsed.pathname.split('/').at(-1);
          if (id === 'messages') {
            assert.equal(parsed.searchParams.get('maxResults'), '50');
            assert.equal(parsed.searchParams.get('includeSpamTrash'), 'false');
            assert.equal(parsed.searchParams.get('q'), 'from:noreply@donuts.ne.jp subject:シフト確定 newer_than:45d -in:spam -in:trash');
            return response(200, { messages: messages.map(({ id }) => ({ id })) });
          }
          assert.equal(parsed.searchParams.get('format'), 'metadata');
          assert.deepEqual(parsed.searchParams.getAll('metadataHeaders'), ['From', 'Subject', 'Date']);
          assert.equal(parsed.searchParams.get('fields'), 'id,internalDate,payload/headers');
          return response(200, messages.find(message => message.id === id));
        }
        assert.equal(url, endpoint);
        assert.equal(options.method, 'post');
        assert.equal(options.headers.Authorization, 'Bearer ' + applicationToken);
        const payload = JSON.parse(options.payload);
        if (endpointReply) return endpointReply(payload, response);
        return response(200, payload.dryRun ? { ok: true, dryRun: true, persisted: false, shifts: [] } : { ok: true, persisted: true });
      },
    },
  });
  vm.runInContext(source, context, { filename: 'Code.gs' });
  return {
    context, calls, logs, saved, triggers, trigger,
    get lockReleases() { return lockReleases; },
    get createdCount() { return createdCount; },
    posts() { return calls.filter(call => call.url === endpoint); },
  };
}

test('setup validates properties and installs exactly one five-minute trigger, preserving others', () => {
  const h = harness();
  h.triggers.push(h.trigger('unrelated'), h.trigger('syncConfirmedShifts'), h.trigger('syncConfirmedShifts'));
  h.context.setup();
  h.context.setup();
  assert.deepEqual(h.triggers.map(item => item.handler), ['unrelated', 'syncConfirmedShifts']);
  assert.equal(h.createdCount, 2);
  assert.equal(h.calls.length, 0);
  assert.equal(h.lockReleases, 2);
  assert.deepEqual(h.logs.map(value => JSON.parse(value)), [
    { ok: true, intervalMinutes: 5 }, { ok: true, intervalMinutes: 5 },
  ]);
});

test('configuration error cannot install trigger or send credentials to another destination', () => {
  for (const extraProperties of [
    { SHARE_TIME_SYNC_URL: 'https://attacker.example/api/integrations/jobcan' },
    { SHARE_TIME_SYNC_URL: endpoint + '?redirect=somewhere' },
    { SHARE_TIME_SYNC_TOKEN: 'short' },
    { SHARE_TIME_SYNC_TOKEN: applicationToken + '\n' },
  ]) {
    const h = harness({ extraProperties });
    assert.throws(() => h.context.setup(), /INVALID_SYNC_/);
    assert.equal(h.triggers.length, 0);
    assert.equal(h.calls.length, 0);
    assert.equal(h.lockReleases, 1);
    assert.deepEqual(h.logs, []);
  }
});

test('stop removes only this handler triggers', () => {
  const h = harness();
  h.triggers.push(h.trigger('unrelated'), h.trigger('syncConfirmedShifts'), h.trigger('syncConfirmedShifts'));
  h.context.stop();
  assert.deepEqual(h.triggers.map(item => item.handler), ['unrelated']);
  assert.deepEqual(h.logs.map(value => JSON.parse(value)), [{ ok: true, stopped: true }]);
});

test('lock contention is quiet and does not read mail or change processed state', () => {
  const h = harness({ locked: true, messages: [confirmation('mail1')] });
  assert.equal(h.context.syncConfirmedShifts().skipped, 'busy');
  assert.equal(h.calls.length, 0);
  assert.equal(h.lockReleases, 0);
  assert.deepEqual(h.logs, []);
});

test('empty mailbox is quiet, metadata-only requests never read bodies or mutate Gmail', () => {
  const h = harness();
  assert.equal(h.context.syncConfirmedShifts().processed, 0);
  assert.equal(h.posts().length, 0);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.logs.map(value => JSON.parse(value)), [{ ok: true, processed: 0 }]);
});

test('latest confirmation per month uses arrival ordering and syncs each notification once', () => {
  const older = confirmation('older');
  const latest = confirmation('newer', undefined, { internalDate: String(Date.parse('2026-09-28T12:00:00+09:00')) });
  const h = harness({ messages: [latest, older] });
  assert.equal(h.context.syncConfirmedShifts().processed, 1);
  assert.equal(h.posts().length, 1);
  const body = JSON.parse(h.posts()[0].options.payload);
  assert.deepEqual(body, { notification: {
    id: 'newer', sentAt: '2026-09-27T03:00:00.000Z', receivedAt: '2026-09-28T03:00:00.000Z',
    subject: '来月シフト確定のお知らせ（じゃんぱら）', month: '2026-10',
  } });
  assert.equal(h.saved.SHARE_TIME_DONE_newer, '2026-10-15T00:00:00.000Z');
  assert.equal(h.saved.SHARE_TIME_DONE_older, undefined);
  assert.equal(h.context.syncConfirmedShifts().processed, 0);
  assert.equal(h.posts().length, 1);
  assert.deepEqual(h.logs.map(value => JSON.parse(value)), [
    { ok: true, processed: 1 }, { ok: true, processed: 0 },
  ]);
});

test('UTC/JST month boundary and December rollover use Date header instead of arrival/current date', () => {
  const h = harness({ now: Date.parse('2026-12-15T00:00:00Z') });
  const metadata = confirmation('yearEnd', 'Thu, 31 Dec 2026 15:00:00 +0000', {
    internalDate: String(Date.parse('2027-01-02T00:00:00Z')),
  });
  const result = h.context.classifyMetadata_(metadata, new Date('2026-12-15T00:00:00Z'));
  assert.equal(result.month, '2027-02');
  assert.equal(result.sentAt, '2026-12-31T15:00:00.000Z');
  assert.equal(result.receivedAt, '2027-01-02T00:00:00.000Z');
});

test('ambiguous subjects, missing timezone, duplicate headers and incorrect sender are ignored', () => {
  const h = harness();
  for (const subject of ['勤務確認のお知らせ', '来月シフト申請のお願い', '来月シフト確定のお知らせ 訂正', 'Fwd: 来月シフト確定のお知らせ']) {
    const metadata = confirmation('a');
    metadata.payload.headers[1].value = subject;
    assert.equal(h.context.classifyMetadata_(metadata, new Date(currentTime)), null);
  }
  for (const from of ['bad@donuts.ne.jp', 'noreply@donuts.ne.jp.example', 'noreply@donuts.ne.jp, other@example.test']) {
    const metadata = confirmation('a');
    metadata.payload.headers[0].value = from;
    assert.equal(h.context.classifyMetadata_(metadata, new Date(currentTime)), null);
  }
  for (const date of ['', 'Sun, 27 Sep 2026 12:00:00', 'not a date +0900']) {
    const metadata = confirmation('a');
    metadata.payload.headers[2].value = date;
    assert.equal(h.context.classifyMetadata_(metadata, new Date(currentTime)), null);
  }
  const duplicate = confirmation('a');
  duplicate.payload.headers.push({ name: 'date', value: 'Sun, 27 Sep 2026 12:00:00 +0900' });
  assert.equal(h.context.classifyMetadata_(duplicate, new Date(currentTime)), null);
});

test('RFC 2047 Base64 and Q Japanese headers are decoded before strict subject matching', () => {
  const h = harness();
  const subject = '来月シフト確定のお知らせ（じゃんぱら）';
  const first = Buffer.from('来月シフト確定のお知らせ').toString('base64');
  const second = Buffer.from('（じゃんぱら）').toString('base64');
  const q = [...Buffer.from(subject)].map(byte => '=' + byte.toString(16).padStart(2, '0')).join('');
  for (const encoded of [
    `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `=?UTF-8?B?${first}?=\r\n =?UTF-8?B?${second}?=`,
    `=?UTF-8?Q?${q}?=`,
  ]) {
    const metadata = confirmation('encoded');
    metadata.payload.headers[1].value = encoded;
    assert.equal(h.context.classifyMetadata_(metadata, new Date(currentTime)).subject, subject);
  }
  for (const malformed of ['=?UTF-8?Q?=ZZ?=', '=?UTF-8?B?!!!!!?=', '=?unknown?B?YWJj?=']) {
    const metadata = confirmation('encoded');
    metadata.payload.headers[1].value = malformed;
    assert.equal(h.context.classifyMetadata_(metadata, new Date(currentTime)), null);
  }
});

test('only current and future target months within 180 days are eligible', () => {
  const h = harness();
  const now = new Date(currentTime);
  assert.equal(h.context.classifyMetadata_(confirmation('old', 'Thu, 27 Aug 2026 12:00:00 +0900'), now), null);
  assert.equal(h.context.classifyMetadata_(confirmation('future', 'Thu, 27 May 2027 12:00:00 +0900'), now), null);
  assert.equal(h.context.classifyMetadata_(confirmation('current'), now).month, '2026-10');
});

test('HTTP 200 dry-run/config/unconfirmed results do not mark processed and retry next run', () => {
  for (const responseBody of [
    { ok: true, persisted: false }, { ok: false, error: 'configuration' },
    { ok: true, dryRun: true, persisted: true }, { ok: true }, 'not-json',
  ]) {
    const h = harness({ messages: [confirmation('a')], endpointReply: (payload, response) => response(200, responseBody) });
    assert.throws(() => h.context.syncConfirmedShifts(), /ShareTime sync:/);
    assert.equal(h.saved.SHARE_TIME_DONE_a, undefined);
    assert.throws(() => h.context.syncConfirmedShifts(), /ShareTime sync:/);
    assert.equal(h.posts().length, 2);
    assert.equal(h.lockReleases, 2);
    assert.deepEqual(h.logs, []);
  }
});

test('retriable busy errors surface without immediate replay or processed marks', () => {
  const h = harness({ messages: [confirmation('a')], endpointReply: (payload, response) => response(409, { ok: false, error: applicationToken }) });
  assert.throws(() => h.context.syncConfirmedShifts(), /ENDPOINT_HTTP_409/);
  assert.equal(h.posts().length, 1);
  assert.equal(h.saved.SHARE_TIME_DONE_a, undefined);
  assert.deepEqual(h.logs, []);
});

test('non-200 known server error codes are diagnosable without exposing messages or logging failures', () => {
  for (const code of ['JOBCAN_PARSE', 'JOBCAN_LOGIN', 'JOBCAN_INCOMPLETE', 'JOBCAN_NETWORK', 'JOBCAN_TIMEOUT', 'JOBCAN_CONFIG', 'JOBCAN_IDENTITY', 'SYNC_BUSY', 'CONFIG_REQUIRED']) {
    const h = harness({ messages: [confirmation('a')], endpointReply: (payload, response) => response(502, {
      ok: false, error: { code, message: `secret ${applicationToken} ${oauthToken}` }, password: 'mock-password',
    }) });
    assert.throws(() => h.context.previewLatest(), error => {
      assert.equal(error.message, 'ShareTime sync: ENDPOINT_HTTP_502_' + code);
      assert.equal(error.message.includes(applicationToken), false);
      assert.equal(error.message.includes(oauthToken), false);
      return true;
    });
    assert.deepEqual(h.logs, []);
    assert.equal(h.saved.SHARE_TIME_DONE_a, undefined);
    assert.equal(h.posts().length, 1);
  }
});

test('unknown, malformed or credential-like server codes retain only the HTTP status', () => {
  for (const data of [
    '<html>upstream failure ' + applicationToken + '</html>',
    { error: { code: 'JOBCAN_CUSTOM_UNKNOWN', message: applicationToken } },
    { error: { code: 'SECRET_PASSWORD_TOKEN', message: oauthToken } },
    { error: { code: 'JOBCAN_PARSE\n' + applicationToken } },
    { error: { code: null } }, { error: { code: ['JOBCAN_PARSE'] } },
    { error: 'JOBCAN_PARSE' }, null,
  ]) {
    const h = harness({ messages: [confirmation('a')], endpointReply: (payload, response) => response(502, data) });
    assert.throws(() => h.context.previewLatest(), error => error.message === 'ShareTime sync: ENDPOINT_HTTP_502');
    assert.deepEqual(h.logs, []);
  }
});

test('network exceptions are sanitized and never include secrets or headers', () => {
  const h = harness({ fetchError: `Network failed ${applicationToken} ${oauthToken}` });
  try {
    h.context.syncConfirmedShifts();
    assert.fail('expected failure');
  } catch (error) {
    assert.equal(error.message, 'ShareTime sync: GMAIL_NETWORK_ERROR');
    assert.equal(error.message.includes(applicationToken), false);
    assert.equal(error.message.includes(oauthToken), false);
  }
  assert.deepEqual(h.logs, []);
});

test('preview sends dryRun true, exposes only preview result and never marks a message processed', () => {
  const h = harness({ messages: [confirmation('a')] });
  const preview = h.context.previewLatest();
  assert.equal(preview.dryRun, true);
  assert.equal(preview.results.length, 1);
  assert.equal(JSON.parse(h.posts()[0].options.payload).dryRun, true);
  assert.equal(h.saved.SHARE_TIME_DONE_a, undefined);
  assert.equal(h.context.syncConfirmedShifts().processed, 1);
  assert.equal(h.posts().length, 2);
  const previewLog = JSON.parse(h.logs[0]);
  assert.equal(previewLog.dryRun, true);
  assert.equal(previewLog.results[0].notification.id, 'a');
  assert.deepEqual(previewLog.results[0].result.shifts, []);
  assert.deepEqual(JSON.parse(h.logs[1]), { ok: true, processed: 1 });
});

test('preview success log permits shift dates and notification metadata but strips secrets and arbitrary diagnostics', () => {
  const h = harness({ messages: [confirmation('a')], endpointReply: (payload, response) => response(200, {
    ok: true, dryRun: true, persisted: false, created: 1,
    token: applicationToken, password: 'mock-password-do-not-log', error: oauthToken,
    reason: applicationToken, details: { Authorization: oauthToken },
    shifts: [{
      date: '2026-10-20', startTime: '12:00', endTime: '21:00',
      password: 'mock-password-do-not-log', token: applicationToken,
    }],
  }) });
  const returned = h.context.previewLatest();
  assert.equal(returned.results[0].result.token, applicationToken, 'return value remains unchanged');
  assert.equal(h.logs.length, 1);
  const logged = JSON.parse(h.logs[0]);
  assert.deepEqual(logged.results[0].result, {
    ok: true, dryRun: true, persisted: false, month: '2026-10', created: 1,
    shifts: [{ date: '2026-10-20', startTime: '12:00', endTime: '21:00' }],
  });
  for (const secret of [applicationToken, oauthToken, 'mock-password-do-not-log']) {
    assert.equal(h.logs[0].includes(secret), false);
  }
});

test('processed state pruning preserves configuration and unrelated properties', () => {
  const h = harness({ extraProperties: {
    SHARE_TIME_DONE_old: '2025-01-01T00:00:00Z',
    SHARE_TIME_DONE_invalid: 'invalid-date',
    SHARE_TIME_DONE_new: '2026-10-10T00:00:00Z',
    OTHER_PROPERTY: 'keep',
  } });
  h.context.syncConfirmedShifts();
  assert.equal(h.saved.SHARE_TIME_DONE_old, undefined);
  assert.equal(h.saved.SHARE_TIME_DONE_invalid, undefined);
  assert.equal(h.saved.SHARE_TIME_DONE_new, '2026-10-10T00:00:00Z');
  assert.equal(h.saved.OTHER_PROPERTY, 'keep');
  assert.equal(h.saved.SHARE_TIME_SYNC_TOKEN, applicationToken);
});

test('manifest grants only Gmail readonly, external fetch and trigger management scopes', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../integrations/jobcan-gmail/appsscript.json', import.meta.url), 'utf8'));
  assert.equal(manifest.timeZone, 'Asia/Tokyo');
  assert.deepEqual(manifest.oauthScopes, [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.scriptapp',
  ]);
});
