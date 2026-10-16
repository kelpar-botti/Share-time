import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as closure from '../src/lib/day-availability/closure.mjs';

function setup() {
  const records = new Map();
  const clone = value => value === undefined ? undefined : structuredClone(value);
  let sequence = 0; let queue = Promise.resolve(); let attempts = 0;
  const snapshot = ref => ({ id: ref.id, exists: records.has(ref.path), data: () => clone(records.get(ref.path)) });
  function query(name, filters = []) {
    const queryRef = {
      kind: 'query', name, filters,
      doc: (id = `booking-${++sequence}`) => {
        const ref = { kind: 'doc', id, path: `${name}/${id}`, get: async () => snapshot(ref), set: async data => records.set(ref.path, clone(data)), update: async data => records.set(ref.path, { ...records.get(ref.path), ...clone(data) }) };
        return ref;
      },
      where: (field, operator, expected) => query(name, [...filters, [field, operator, expected]]),
      get: async () => read(queryRef),
    };
    return queryRef;
  }
  function read(ref) {
    if (ref.kind === 'doc') return snapshot(ref);
    return { docs: [...records].filter(([key, data]) => key.startsWith(`${ref.name}/`) && ref.filters.every(([field, operator, expected]) => operator === '==' ? data[field] === expected : operator === '>=' ? data[field] >= expected : data[field] <= expected)).map(([key]) => snapshot(query(ref.name).doc(key.slice(ref.name.length + 1)))) };
  }
  const signature = ref => {
    const snap = read(ref);
    return JSON.stringify(ref.kind === 'doc' ? [snap.exists, snap.data()] : snap.docs.map(doc => [doc.id, doc.data()]));
  };
  const db = {
    beforeCommit: null,
    collection: name => query(name),
    async runTransaction(callback) {
      const previous = queue; let unlock;
      queue = new Promise(resolve => { unlock = resolve; });
      await previous;
      try {
        for (let retry = 0; retry < 4; retry++) {
          attempts++;
          const reads = []; const writes = [];
          const transaction = {
            async get(ref) { assert.equal(writes.length, 0, 'all transaction reads precede writes'); reads.push([ref, signature(ref)]); return read(ref); },
            set: (ref, data) => writes.push({ ref, data: clone(data), merge: false }),
            update: (ref, data) => writes.push({ ref, data: clone(data), merge: true }),
          };
          const result = await callback(transaction);
          if (db.beforeCommit) await db.beforeCommit(writes);
          if (reads.some(([ref, old]) => signature(ref) !== old)) continue;
          for (const { ref, data, merge } of writes) records.set(ref.path, merge ? { ...records.get(ref.path), ...data } : data);
          return result;
        }
        throw new Error('transaction retries exhausted');
      } finally { unlock(); }
    },
  };
  const root = fileURLToPath(new URL('../', import.meta.url));
  const cache = new Map(); const nativeRequire = createRequire(import.meta.url);
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    if (filename.endsWith('firebase-admin.ts')) return { getDb: () => db };
    const loadedModule = { exports: {} }; cache.set(filename, loadedModule);
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename }).outputText;
    const imports = id => {
      if (id === 'server-only') return {};
      if (id.endsWith('/day-availability/closure.mjs')) return closure;
      if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), id) + '.ts');
      return nativeRequire(id);
    };
    vm.runInNewContext(`(function(require,module,exports) { ${output}\n})`, { Date, console, process: { env: { ADMIN_EMAIL: 'owner@example.test' } } }, { filename })(imports, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return {
    records, db, get attempts() { return attempts; },
    service: closure.createClosureService({ db, ownerEmail: 'owner@example.test', clock: () => '2026-10-15T00:00:00Z' }),
    bookings: load(path.join(root, 'src/lib/bookings.ts')),
  };
}
const proposal = (overrides = {}) => ({ id: 'line_confirmation_1', dates: ['2026-10-20'], summary: '友人との予定', evidence: '20日に行こう → 了解', source: 'line', confidence: 'high', ...overrides });
const request = (overrides = {}) => ({ date: '2026-10-20', startTime: '13:00', endTime: '14:00', name: 'Visitor', email: '', message: 'meeting', title: '', titlePublicAllowed: false, ...overrides });

test('proposal creation and dismissal never close dates; dismiss is idempotent and owner-scoped', async () => {
  const env = setup();
  const item = await env.service.createSuggestion(proposal());
  assert.equal(item.status, 'pending');
  assert.equal((await env.service.getDayAvailability('2026-10-20')).closed, false);
  const rejected = await env.service.dismissSuggestion(item.id);
  assert.equal(rejected.changed, true);
  assert.equal((await env.service.dismissSuggestion(item.id)).changed, false);
  assert.equal((await env.service.getDayAvailability('2026-10-20')).closed, false);
  const otherOwner = closure.createClosureService({ db: env.db, ownerEmail: 'other@example.test' });
  await assert.rejects(otherOwner.getSuggestion(item.id), { code: 'not_found' });
  assert.deepEqual(await otherOwner.listSuggestions(), []);
  await assert.rejects(env.service.acceptSuggestion(item.id), { code: 'already_handled' });
});

test('owner can edit selected dates before confirmation; retry preserves accepted decision', async () => {
  const env = setup(); const item = await env.service.createSuggestion(proposal());
  const accepted = await env.service.acceptSuggestion(item.id, ['2026-10-21', '2026-10-22', '2026-10-21']);
  assert.equal(accepted.changed, true);
  assert.deepEqual(accepted.suggestion.acceptedDates, ['2026-10-21', '2026-10-22']);
  assert.equal((await env.service.getDayAvailability('2026-10-20')).closed, false);
  assert.equal((await env.service.getDayAvailability('2026-10-21')).closed, true);
  const before = structuredClone([...env.records]);
  assert.equal((await env.service.acceptSuggestion(item.id, ['2026-10-22', '2026-10-21'])).changed, false);
  assert.equal((await env.service.acceptSuggestion(item.id)).changed, false);
  assert.deepEqual([...env.records], before);
  await assert.rejects(env.service.acceptSuggestion(item.id, ['2026-10-23']), { code: 'already_handled' });
  await assert.rejects(env.service.dismissSuggestion(item.id), { code: 'already_handled' });
  const duplicate = await env.service.createSuggestion(proposal({ summary: 'different retry text' }));
  assert.equal(duplicate.status, 'accepted');
});

test('direct visitor creation is refused on a closed date, even without form availability precheck', async () => {
  const env = setup(); await env.service.createSuggestion(proposal()); await env.service.acceptSuggestion('line_confirmation_1');
  await assert.rejects(env.bookings.createBookingRequest(request()), { code: 'closed' });
  assert.equal([...env.records.keys()].filter(key => key.startsWith('bookings/')).length, 0);
  await env.bookings.createBookingRequest(request({ date: '2026-10-21' }));
  assert.equal(await env.bookings.isRangeAvailable('2026-10-20', '01:00', '02:00'), false);
});

test('actual occupied dates include overnight time but exclude midnight end', async () => {
  assert.deepEqual(closure.occupiedDates(request({ startTime: '23:30', endTime: '00:30' })), ['2026-10-20', '2026-10-21']);
  assert.deepEqual(closure.occupiedDates(request({ startTime: '23:30', endTime: '00:00' })), ['2026-10-20']);
  const env = setup(); await env.service.createSuggestion(proposal({ dates: ['2026-10-21'] })); await env.service.acceptSuggestion('line_confirmation_1');
  await assert.rejects(env.bookings.createBookingRequest(request({ startTime: '23:30', endTime: '00:30' })), { code: 'closed' });
  await env.bookings.createBookingRequest(request({ startTime: '23:30', endTime: '00:00' }));
});

test('existing pending reservations remain approvable; new time changes cannot bypass closure', async () => {
  const env = setup(); const booking = await env.bookings.createBookingRequest(request());
  await env.service.createSuggestion(proposal());
  const accepted = await env.service.acceptSuggestion('line_confirmation_1');
  assert.equal(accepted.existingBookingCount, 1);
  assert.equal(env.records.get(`bookings/${booking.id}`).status, 'pending');
  const response = await env.bookings.respondToBookingByToken(booking.id, booking.approveToken, 'approve');
  assert.equal(response.ok, true);
  assert.equal(env.records.get(`bookings/${booking.id}`).status, 'approved');
  const result = await env.bookings.updateBookingTimeByToken(booking.id, booking.titleToken, '13:00', '15:00');
  assert.equal(result.ok, false); assert.equal(result.reason, 'taken');
  assert.equal(env.records.get(`bookings/${booking.id}`).endTime, '14:00');
  await env.bookings.setBookingStatus(booking.id, 'cancelled');
  await assert.rejects(env.bookings.setBookingStatus(booking.id, 'approved'), { code: 'closed' });
});

test('closed next date refuses overnight resize; midnight end preserves actual prior day range', async () => {
  const env = setup(); const booking = await env.bookings.createBookingRequest(request({ startTime: '22:00', endTime: '23:00' }));
  await env.bookings.setBookingStatus(booking.id, 'approved');
  await env.service.createSuggestion(proposal({ dates: ['2026-10-21'] })); await env.service.acceptSuggestion('line_confirmation_1');
  assert.equal((await env.bookings.updateBookingTimeByToken(booking.id, booking.titleToken, '22:00', '00:30')).ok, false);
  assert.equal((await env.bookings.updateBookingTimeByToken(booking.id, booking.titleToken, '22:00', '00:00')).ok, true);
});

test('booking transaction retries and refuses when date closes between guard read and write', async () => {
  const env = setup(); let injected = false;
  env.db.beforeCommit = writes => {
    if (!injected && writes.some(write => write.ref.path.startsWith('bookings/'))) {
      injected = true; env.records.set('dayAvailability/2026-10-20', { date: '2026-10-20', closed: true, proposalIds: ['racing_confirmation'], revision: 1 });
    }
  };
  await assert.rejects(env.bookings.createBookingRequest(request()), { code: 'closed' });
  assert.equal(env.attempts, 2);
  assert.equal([...env.records.keys()].filter(key => key.startsWith('bookings/')).length, 0);
});

test('confirmation retries around competing visitor write and counts preserved booking', async () => {
  const env = setup(); await env.service.createSuggestion(proposal()); let injected = false;
  env.db.beforeCommit = writes => {
    if (!injected && writes.some(write => write.ref.path === 'dayAvailability/2026-10-20')) {
      injected = true;
      env.records.set('dayAvailability/2026-10-20', { date: '2026-10-20', closed: false, revision: 1 });
      env.records.set('bookings/racing_booking', { ...request(), status: 'pending', source: 'visitor' });
    }
  };
  const result = await env.service.acceptSuggestion('line_confirmation_1');
  assert.equal(result.existingBookingCount, 1);
  assert.equal(env.records.get('bookings/racing_booking').status, 'pending');
  assert.equal(env.records.get('dayAvailability/2026-10-20').closed, true);
});

test('simultaneous proposals for the same date both persist their reason without reopening', async () => {
  const env = setup();
  await env.service.createSuggestion(proposal({ id: 'first' }));
  await env.service.createSuggestion(proposal({ id: 'second', source: 'discord' }));
  const results = await Promise.all([env.service.acceptSuggestion('first'), env.service.acceptSuggestion('second')]);
  assert.ok(results.every(result => result.changed));
  assert.deepEqual(env.records.get('dayAvailability/2026-10-20').proposalIds.sort(), ['first', 'second']);
});

test('two concurrent visitor requests cannot claim overlapping ranges', async () => {
  const env = setup(); const results = await Promise.allSettled([env.bookings.createBookingRequest(request()), env.bookings.createBookingRequest(request())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'taken');
});

test('malformed, impossible, past and over-horizon dates cannot close any calendar day', async () => {
  const env = setup();
  for (const dates of [['2026-02-30'], ['2026-13-01'], ['../bad']]) await assert.rejects(env.service.createSuggestion(proposal({ dates })), { code: 'invalid_date' });
  await env.service.createSuggestion(proposal({ dates: [] }));
  for (const dates of [[], ['2026-10-14'], ['2027-10-16']]) await assert.rejects(env.service.acceptSuggestion('line_confirmation_1', dates), { code: 'invalid_dates' });
  assert.equal([...env.records.keys()].filter(key => key.startsWith('dayAvailability/')).length, 0);
});

test('public availability exposes only date and closed status, never conversation/owner data', async () => {
  const env = setup(); await env.service.createSuggestion(proposal()); await env.service.acceptSuggestion('line_confirmation_1');
  assert.deepEqual(await closure.getDayAvailabilityRange(env.db, '2026-10-19', '2026-10-21'), [
    { date: '2026-10-19', closed: false }, { date: '2026-10-20', closed: true }, { date: '2026-10-21', closed: false },
  ]);
});

test('conversation invalidation is owner scoped, monotonic and only dismisses pending older context', async () => {
  const env = setup(); const conversationKey = 'a'.repeat(64);
  const contextTimestamp = '2026-10-15T00:00:00Z';
  await env.service.createSuggestion(proposal({ id: 'old_pending', conversationKey, contextTimestamp }));
  await env.service.createSuggestion(proposal({ id: 'accepted', conversationKey, contextTimestamp }));
  await env.service.acceptSuggestion('accepted');
  await env.service.createSuggestion(proposal({ id: 'newer_pending', conversationKey, contextTimestamp: '2026-10-15T00:03:00Z' }));
  const other = closure.createClosureService({ db: env.db, ownerEmail: 'other@example.test', clock: () => '2026-10-15T00:00:00Z' });
  await other.createSuggestion(proposal({ id: 'other_owner', conversationKey, contextTimestamp }));
  assert.deepEqual(await env.service.supersedePendingConversation(conversationKey, '2026-10-15T00:02:00Z'), { changed: 1 });
  assert.equal((await env.service.getSuggestion('old_pending')).dismissReason, 'conversation_updated');
  assert.equal((await env.service.getSuggestion('accepted')).status, 'accepted');
  assert.equal((await env.service.getSuggestion('newer_pending')).status, 'pending');
  assert.equal((await other.getSuggestion('other_owner')).status, 'pending');
  assert.deepEqual(await env.service.supersedePendingConversation(conversationKey, '2026-10-15T00:01:00Z'), { changed: 0 });
  const delayed = await env.service.createSuggestion(proposal({ id: 'delayed', conversationKey, contextTimestamp }));
  assert.equal(delayed.status, 'dismissed');
  assert.equal((await env.service.getDayAvailability('2026-10-20')).closed, true);
});

test('half supplied or malformed internal conversation metadata cannot bypass timestamp tombstones', async () => {
  const env = setup();
  for (const metadata of [{ conversationKey: 'a'.repeat(64) }, { contextTimestamp: '2026-10-15T00:00:00Z' }, { conversationKey: 'contact-name', contextTimestamp: '2026-10-15T00:00:00Z' }, { conversationKey: 'a'.repeat(64), contextTimestamp: 'invalid' }]) {
    await assert.rejects(env.service.createSuggestion(proposal(metadata)), { code: 'invalid_conversation_context' });
  }
  assert.equal((await env.service.listSuggestions()).length, 0);
});

test('proposal creation retries around a cancellation cursor and cannot persist stale pending state', async () => {
  const env = setup(); const conversationKey = 'b'.repeat(64); let injected = false;
  env.db.beforeCommit = writes => {
    if (!injected && writes.some(write => write.ref.path === 'scheduleSuggestions/delayed')) {
      injected = true;
      const ownerKey = writes.find(write => write.ref.path === 'scheduleSuggestions/delayed').data.ownerKey;
      env.records.set(`scheduleConversationCursors/${ownerKey}_${conversationKey}`, { ownerKey, conversationKey, invalidatedThrough: '2026-10-15T00:02:00.000Z' });
    }
  };
  const delayed = await env.service.createSuggestion(proposal({ id: 'delayed', conversationKey, contextTimestamp: '2026-10-15T00:00:00Z' }));
  assert.equal(env.attempts, 2);
  assert.equal(delayed.status, 'dismissed'); assert.equal(delayed.dismissReason, 'conversation_updated');
  assert.equal((await env.service.getDayAvailability('2026-10-20')).closed, false);
});

test('conversation invalidation retries around a competing owner confirmation and preserves the accepted day', async () => {
  const env = setup(); const conversationKey = 'c'.repeat(64); let injected = false;
  const item = await env.service.createSuggestion(proposal({ conversationKey, contextTimestamp: '2026-10-15T00:00:00Z' }));
  env.db.beforeCommit = writes => {
    if (!injected && writes.some(write => write.ref.path.startsWith('scheduleConversationCursors/'))) {
      injected = true;
      env.records.set(`scheduleSuggestions/${item.id}`, { ...env.records.get(`scheduleSuggestions/${item.id}`), status: 'accepted', acceptedDates: ['2026-10-20'] });
      env.records.set('dayAvailability/2026-10-20', { date: '2026-10-20', closed: true, proposalIds: [item.id], revision: 1 });
    }
  };
  assert.deepEqual(await env.service.supersedePendingConversation(conversationKey, '2026-10-15T00:02:00Z'), { changed: 0 });
  assert.equal(env.attempts, 3);
  assert.equal((await env.service.getSuggestion(item.id)).status, 'accepted');
  assert.equal((await env.service.getDayAvailability('2026-10-20')).closed, true);
});
