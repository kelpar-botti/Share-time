import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createConversationHandler } from '../src/lib/day-availability/handler.mjs';
import { createDeviceService } from '../src/lib/day-availability/devices.mjs';
import { createClosureService, getDayAvailability } from '../src/lib/day-availability/closure.mjs';

const OWNER = 'owner@example.test';
const BASE_TIME = '2026-10-15T01:00:00Z';
const ENDPOINT = 'https://share-time.example.test/api/integrations/conversations';

function setup() {
  const records = new Map(); const clone = value => value === undefined ? undefined : structuredClone(value);
  let sequence = 0; let queue = Promise.resolve(); let writes = 0; let dbInitializations = 0; let time = BASE_TIME;
  const snapshot = (collection, id) => ({ id, exists: records.has(`${collection}/${id}`), data: () => clone(records.get(`${collection}/${id}`)) });
  function query(collection, filters = []) {
    return {
      doc(id = `test-${++sequence}`) {
        const ref = { id, path: `${collection}/${id}`, get: async () => snapshot(collection, id), set: async value => { writes++; records.set(ref.path, clone(value)); } };
        return ref;
      },
      where: (field, operator, value) => query(collection, [...filters, [field, operator, value]]),
      async get() {
        return { docs: [...records].filter(([key, value]) => key.startsWith(`${collection}/`) && filters.every(([field, operator, expected]) => operator === '==' ? value[field] === expected : operator === '>=' ? value[field] >= expected : value[field] <= expected)).map(([key]) => snapshot(collection, key.slice(collection.length + 1))) };
      },
    };
  }
  const db = {
    collection: name => query(name),
    async runTransaction(callback) {
      const previous = queue; let unlock; queue = new Promise(resolve => { unlock = resolve; }); await previous;
      try {
        const pending = [];
        const result = await callback({
          async get(ref) { assert.equal(pending.length, 0, 'Firestore reads precede writes'); return ref.get(); },
          set: (ref, value) => pending.push([ref, clone(value), false]),
          update: (ref, value) => pending.push([ref, clone(value), true]),
        });
        for (const [ref, value, merge] of pending) { records.set(ref.path, merge ? { ...records.get(ref.path), ...value } : value); writes++; }
        return result;
      } finally { unlock(); }
    },
  };
  const clock = () => time;
  const devices = createDeviceService({ db, ownerEmail: OWNER, clock });
  const closure = createClosureService({ db, ownerEmail: OWNER, clock });
  const handler = createConversationHandler({ getDb: () => { dbInitializations++; return db; }, env: () => ({ ADMIN_EMAIL: OWNER }), clock });
  return {
    db, records, devices, closure, handler,
    get writes() { return writes; }, get dbInitializations() { return dbInitializations; },
    setTime(value) { time = value; },
  };
}
const message = (id, sender, text, extra = {}) => ({ id, sender, text, sentAt: BASE_TIME, conversationId: 'friend-a', ...extra });
const conversation = (extra = {}) => ({ source: 'line', conversationId: 'friend-a', messages: [
  message('invitation', 'other', '10月20日の14時に映画を見に行こう？'),
  message('agreement', 'self', '了解！その日で大丈夫です'),
], ...extra });
async function call(env, token, method = 'GET', body, headerOverrides = {}) {
  const headers = { ...(token === undefined ? {} : { authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headerOverrides };
  const response = await env.handler(new Request(ENDPOINT, { method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }));
  return { status: response.status, data: await response.json(), response };
}

test('authenticated device proposes, owner edits date and confirms, and only then the whole day closes', async () => {
  const env = setup(); const { token } = await env.devices.issue('Xiaomi');
  const proposed = await call(env, token, 'POST', conversation());
  assert.equal(proposed.status, 200); assert.equal(proposed.data.analysis.status, 'proposal');
  assert.equal(proposed.data.suggestion.status, 'pending');
  assert.equal(proposed.data.suggestion.ownerKey, undefined);
  assert.equal((await getDayAvailability(env.db, '2026-10-20')).closed, false);
  const id = proposed.data.suggestion.id;
  const queue = await call(env, token);
  assert.equal(queue.data.suggestions.length, 1); assert.equal(queue.data.suggestions[0].id, id);
  const accepted = await call(env, token, 'PATCH', { id, action: 'accept', dates: ['2026-10-21'] });
  assert.equal(accepted.status, 200); assert.equal(accepted.data.suggestion.status, 'accepted');
  assert.deepEqual(accepted.data.suggestion.acceptedDates, ['2026-10-21']);
  assert.equal((await getDayAvailability(env.db, '2026-10-20')).closed, false);
  assert.equal((await getDayAvailability(env.db, '2026-10-21')).closed, true);
  assert.equal((await call(env, token)).data.suggestions.length, 0);
  assert.equal((await call(env, token, 'PATCH', { id, action: 'accept' })).data.changed, false);
  const replay = await call(env, token, 'POST', conversation());
  assert.equal(replay.data.suggestion.status, 'accepted');
  assert.equal((await env.closure.listSuggestions()).length, 1);
});

test('dismissed proposal remains dismissed on retransmission and leaves every calendar date unchanged', async () => {
  const env = setup(); const { token } = await env.devices.issue('Android');
  const posted = await call(env, token, 'POST', conversation()); const id = posted.data.suggestion.id;
  assert.equal((await call(env, token, 'PATCH', { id, action: 'dismiss' })).data.changed, true);
  assert.equal((await call(env, token, 'PATCH', { id, action: 'dismiss' })).data.changed, false);
  const replay = await call(env, token, 'POST', conversation());
  assert.equal(replay.data.suggestion.status, 'dismissed');
  assert.equal((await call(env, token)).data.suggestions.length, 0);
  assert.equal((await call(env, token, 'PATCH', { id, action: 'accept', dates: ['2026-10-20'] })).status, 409);
  assert.equal([...env.records.keys()].filter(key => key.startsWith('dayAvailability/')).length, 0);
});

test('clarifications stay pending without selected dates and can be reviewed or ignored on the device', async () => {
  const env = setup(); const { token } = await env.devices.issue('Android');
  const uncertain = conversation({ messages: [message('ambiguous', 'self', '20日でOK')] });
  const response = await call(env, token, 'POST', uncertain);
  assert.equal(response.data.analysis.status, 'needs_clarification');
  assert.deepEqual(response.data.suggestion.dates, []);
  assert.equal([...env.records.keys()].some(key => key.startsWith('dayAvailability/')), false);
  const confirmed = await call(env, token, 'PATCH', { id: response.data.suggestion.id, action: 'accept', dates: ['2026-10-23'] });
  assert.equal(confirmed.status, 200); assert.equal((await getDayAvailability(env.db, '2026-10-23')).closed, true);
});

test('only hashed credentials are stored and neither device listing nor response returns plaintext tokens', async () => {
  const env = setup(); const issued = await env.devices.issue('Xiaomi');
  const hash = createHash('sha256').update(issued.token).digest('hex');
  assert.equal(issued.device.id, hash); assert.equal(env.records.has(`calendarDevices/${hash}`), true);
  assert.equal(JSON.stringify([...env.records]).includes(issued.token), false);
  const listed = await env.devices.list();
  assert.equal(listed[0].id, hash); assert.equal(JSON.stringify(listed).includes(issued.token), false);
  const api = await call(env, issued.token);
  assert.equal(JSON.stringify(api.data).includes(issued.token), false);
  assert.equal(api.response.headers.get('cache-control'), 'private, no-store');
});

test('invalid, cross-owner, revoked and expired credentials cannot store proposals or calendar changes', async () => {
  const env = setup(); const issued = await env.devices.issue('Android');
  for (const token of [undefined, '', 'invalid', `stc_${'a'.repeat(43)}`]) assert.equal((await call(env, token, 'POST', conversation())).status, 401);
  const wrongOwner = createDeviceService({ db: env.db, ownerEmail: 'other@example.test', clock: () => BASE_TIME });
  const other = await wrongOwner.issue('Other device');
  assert.equal((await call(env, other.token, 'POST', conversation())).status, 401);
  await env.devices.revoke(issued.device.id);
  assert.equal((await call(env, issued.token, 'POST', conversation())).status, 401);
  const expired = await env.devices.issue('Expired'); env.setTime('2027-01-14T01:00:00Z');
  assert.equal((await call(env, expired.token, 'POST', conversation())).status, 401);
  assert.equal([...env.records.keys()].some(key => key.startsWith('scheduleSuggestions/') || key.startsWith('dayAvailability/')), false);
});

test('browser-origin requests and unsupported methods fail before database initialization', async () => {
  const env = setup();
  assert.equal((await call(env, undefined, 'POST', conversation(), { origin: 'https://attacker.example.test' })).status, 403);
  assert.equal((await call(env, undefined, 'DELETE')).status, 405);
  assert.equal(env.dbInitializations, 0); assert.equal(env.writes, 0);
});

test('malformed persisted expiration or unavailable server time cannot grant an unbounded device session', async () => {
  const env = setup(); const issued = await env.devices.issue('Android');
  const path = `calendarDevices/${issued.device.id}`;
  const original = structuredClone(env.records.get(path));
  for (const expiresAt of [undefined, '', 'invalid-date']) {
    env.records.set(path, { ...original, expiresAt });
    assert.equal((await call(env, issued.token, 'POST', conversation())).status, 401);
  }
  env.records.set(path, original); env.setTime('invalid-time');
  assert.equal((await call(env, issued.token, 'POST', conversation())).status, 401);
  assert.equal((await env.closure.listSuggestions()).length, 0);
});

test('stream byte limits, invalid JSON and unsupported content types do not create proposals', async () => {
  const env = setup(); const { token } = await env.devices.issue('Android');
  const oversized = JSON.stringify({ text: 'a'.repeat(128 * 1024) });
  for (const headers of [{}, { 'content-length': String(oversized.length) }]) {
    const result = await call(env, token, 'POST', oversized, headers);
    assert.equal(result.status, 400); assert.equal(result.data.error.code, 'body_too_large');
  }
  assert.equal((await call(env, token, 'POST', '{bad')).data.error.code, 'invalid_json');
  assert.equal((await call(env, token, 'POST', conversation(), { 'content-type': 'text/plain' })).data.error.code, 'invalid_json');
  assert.equal((await env.closure.listSuggestions()).length, 0);
});

test('cross-thread messages, conflicting IDs and forged server-owned fields are rejected', async () => {
  const env = setup(); const { token } = await env.devices.issue('Android');
  const cases = [
    conversation({ messages: [message('a', 'other', '20日に映画に行こう'), message('b', 'self', '了解', { conversationId: 'friend-b' })] }),
    conversation({ ownerEmail: 'other@example.test' }),
    conversation({ messages: [message('same', 'other', '20日に映画に行こう'), message('same', 'self', '了解')] }),
    conversation({ messages: [message('a', 'other', '20日に映画に行こう', { sender: 'admin' })] }),
    conversation({ messages: [message('future', 'other', '20日に映画に行こう', { sentAt: '2026-10-16T00:00:00Z' })] }),
    conversation({ messages: Array.from({ length: 81 }, (_, index) => message(`id_${index}`, 'other', 'hello')) }),
  ];
  for (const input of cases) {
    const result = await call(env, token, 'POST', input);
    assert.equal(result.status, 400); assert.equal(result.data.error.code, 'invalid_conversation');
  }
  assert.equal((await env.closure.listSuggestions()).length, 0);
});

test('full history is not persisted; only bounded evidence surrounding the agreement is retained', async () => {
  const env = setup(); const { token } = await env.devices.issue('Android');
  const input = conversation({ messages: [message('old', 'other', 'UNRELATED_PRIVATE_HISTORY'), ...conversation().messages] });
  const result = await call(env, token, 'POST', input);
  assert.equal(result.status, 200); assert.equal(result.data.analysis.status, 'proposal');
  const persisted = JSON.stringify([...env.records]);
  assert.equal(persisted.includes('UNRELATED_PRIVATE_HISTORY'), false);
  assert.equal(result.data.suggestion.evidence.includes('映画'), true);
  assert.ok(result.data.suggestion.evidence.length <= 2000);
});

test('stale agreement replay with newer unrelated messages cannot create a new pending proposal', async () => {
  const env = setup(); const { token } = await env.devices.issue('Android');
  const input = conversation({ messages: [...conversation().messages, message('after', 'other', 'よろしくね')] });
  const result = await call(env, token, 'POST', input);
  assert.equal(result.status, 200); assert.equal(result.data.suggestion, undefined);
  assert.equal((await env.closure.listSuggestions()).length, 0);
});

test('old unresolved clarification does not reappear when an unrelated latest message arrives', async () => {
  const env = setup(); const { token } = await env.devices.issue('Android');
  const ambiguous = [message('offer', 'unknown', '20日に映画に行こう'), message('agreement', 'self', '了解')];
  const first = await call(env, token, 'POST', conversation({ messages: ambiguous }));
  assert.equal(first.data.analysis.status, 'needs_clarification');
  await call(env, token, 'PATCH', { id: first.data.suggestion.id, action: 'dismiss' });
  const replay = await call(env, token, 'POST', conversation({ messages: [...ambiguous, message('new', 'other', '写真を送ったよ')] }));
  assert.equal(replay.data.suggestion, undefined);
  assert.equal((await call(env, token)).data.suggestions.length, 0);
});

test('insufficient planning context is reviewable without guessing a date or closing the calendar', async () => {
  const env = setup(); const { token } = await env.devices.issue('Android');
  const input = conversation({ messages: [message('a', 'other', '20日に映画に行こう'), message('b', 'other', '21日は雨らしい')] });
  const result = await call(env, token, 'POST', input);
  assert.equal(result.data.analysis.status, 'needs_clarification');
  assert.equal(result.data.analysis.clarification.reason, 'INSUFFICIENT_PLAN_CONTEXT');
  assert.deepEqual(result.data.suggestion.dates, []);
  assert.equal([...env.records.keys()].some(key => key.startsWith('dayAvailability/')), false);
  const replay = await call(env, token, 'POST', conversation({ messages: [...input.messages, message('c', 'self', '了解')] }));
  assert.equal(replay.data.analysis.status, 'none');
  assert.equal(replay.data.suggestion, undefined);
});

test('per-device request limit is enforced and resets next minute without granting cross-owner access', async () => {
  const env = setup(); const { token } = await env.devices.issue('Android');
  for (let index = 0; index < 30; index++) assert.equal((await call(env, token)).status, 200);
  const limited = await call(env, token);
  assert.equal(limited.status, 429); assert.equal(limited.data.error.code, 'RATE_LIMIT');
  env.setTime('2026-10-15T01:01:00Z');
  assert.equal((await call(env, token)).status, 200);
});
