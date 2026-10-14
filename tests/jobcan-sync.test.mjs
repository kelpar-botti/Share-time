import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { getSyncState, reconcileMonth, validateMonthSnapshot } from '../src/lib/shift-sync/sync.mjs';

const OWNER = 'owner@example.test';
const NOW = '2026-10-15T00:00:00.000Z';
const OWNER_KEY = createHash('sha256').update(OWNER).digest('hex');

function setup() {
  const records = new Map();
  const clone = value => value === undefined ? undefined : structuredClone(value);
  let committedWrites = 0;
  let attempts = 0;
  const snapshot = ref => ({ id: ref.id, exists: records.has(ref.path), data: () => clone(records.get(ref.path)) });
  function query(collectionName, filters = []) {
    return {
      kind: 'query', collectionName, filters,
      doc: id => {
        const ref = { kind: 'doc', id, path: `${collectionName}/${id}`, get: async () => snapshot(ref) };
        return ref;
      },
      where: (field, operator, expected) => query(collectionName, [...filters, [field, operator, expected]]),
      get: async () => readQuery(collectionName, filters),
    };
  }
  function readQuery(collectionName, filters) {
    return { docs: [...records].filter(([key, data]) => key.startsWith(`${collectionName}/`) && filters.every(([field, operator, expected]) => {
      if (operator === '==') return data[field] === expected;
      if (operator === '>=') return data[field] >= expected;
      if (operator === '<=') return data[field] <= expected;
      throw new Error(`Unknown operator ${operator}`);
    })).map(([key]) => snapshot(query(collectionName).doc(key.slice(collectionName.length + 1)))) };
  }
  const db = {
    retryFirst: false,
    failCommit: false,
    afterFirstAttempt: null,
    collection: name => query(name),
    runTransaction: async callback => {
      for (let attempt = 0; attempt < 2; attempt++) {
        attempts++;
        const writes = [];
        const transaction = {
          get: async ref => {
            assert.equal(writes.length, 0, 'Firestore must execute every read before the first write');
            return ref.kind === 'query' ? readQuery(ref.collectionName, ref.filters) : snapshot(ref);
          },
          set: (ref, data) => writes.push({ kind: 'set', ref, data: clone(data) }),
          update: (ref, data) => writes.push({ kind: 'update', ref, data: clone(data) }),
        };
        const result = await callback(transaction);
        if (db.retryFirst && attempt === 0) {
          if (db.afterFirstAttempt) await db.afterFirstAttempt();
          continue;
        }
        if (db.failCommit) throw new Error('simulated transaction commit failure');
        const nextRecords = new Map(records);
        for (const write of writes) {
          if (write.kind === 'update') {
            assert.ok(nextRecords.has(write.ref.path), 'update must target an existing document');
            nextRecords.set(write.ref.path, { ...clone(nextRecords.get(write.ref.path)), ...write.data });
          } else nextRecords.set(write.ref.path, write.data);
        }
        records.clear();
        for (const entry of nextRecords) records.set(...entry);
        committedWrites += writes.length;
        return result;
      }
      throw new Error('retry attempts exhausted');
    },
  };
  return {
    records, db,
    get committedWrites() { return committedWrites; },
    get attempts() { return attempts; },
    bookings: () => [...records].filter(([key]) => key.startsWith('bookings/')).map(([key, data]) => ({ id: key.slice('bookings/'.length), ...clone(data) })),
  };
}

function snapshot(shifts = [{ date: '2026-10-20', startTime: '16:00', endTime: '21:00' }], month = '2026-10') {
  const [year, number] = month.split('-').map(Number);
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { month, complete: true, coveredDates: Array.from({ length }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`), shifts };
}

function notification(id = 'gmail-1', receivedAt = '2026-10-14T12:00:00.000Z', month = '2026-10') {
  return { id, receivedAt, subject: '来月シフト確定のお知らせ', month };
}

function sync(env, overrides = {}) {
  return reconcileMonth({ db: env.db, snapshot: snapshot(), notification: notification(), ownerEmail: OWNER, now: NOW, ...overrides });
}

test('complete valid month is normalized without mutating its input, including leap years', () => {
  const input = snapshot([], '2028-02');
  input.coveredDates.reverse();
  const original = structuredClone(input);
  const result = validateMonthSnapshot(input);
  assert.equal(result.coveredDates.length, 29);
  assert.equal(result.coveredDates[0], '2028-02-01');
  assert.deepEqual(input, original);
});

test('invalid or incomplete month data fails closed with no writes or cursor', async () => {
  const invalid = [
    { ...snapshot(), complete: false },
    { ...snapshot(), coveredDates: snapshot().coveredDates.slice(1) },
    { ...snapshot(), coveredDates: [...snapshot().coveredDates.slice(0, 30), '2026-10-01'] },
    { ...snapshot(), month: '2026-13' },
    { ...snapshot(), shifts: [{ date: '2026-10-32', startTime: '16:00', endTime: '21:00' }] },
    { ...snapshot(), shifts: [{ date: '2026-09-30', startTime: '16:00', endTime: '21:00' }] },
    { ...snapshot(), shifts: [{ date: '2026-10-20', startTime: '24:00', endTime: '25:00' }] },
    { ...snapshot(), shifts: [{ date: '2026-10-20', startTime: '16:60', endTime: '21:00' }] },
    { ...snapshot(), shifts: [{ date: '2026-10-20', startTime: '16:00', endTime: '16:00' }] },
    { ...snapshot(), shifts: [snapshot().shifts[0], snapshot().shifts[0]] },
    { ...snapshot(), shifts: 'login-page' },
  ];
  for (const input of invalid) {
    const env = setup();
    await assert.rejects(sync(env, { snapshot: input }), /Jobcan sync:/);
    assert.equal(env.committedWrites, 0);
    assert.equal(env.records.size, 0);
  }
});

test('notification month mismatch and invalid timestamp leave the calendar unchanged', async () => {
  for (const event of [notification('gmail-1', NOW, '2026-11'), notification('gmail-1', 'not-a-date')]) {
    const env = setup();
    await assert.rejects(sync(env, { notification: event }), /Jobcan sync:/);
    assert.equal(env.records.size, 0);
  }
});

test('imports are approved, private, schema-compatible, and Gmail cursor commits atomically', async () => {
  const env = setup();
  const result = await sync(env);
  assert.equal(result.created, 1);
  const [booking] = env.bookings();
  assert.match(booking.id, /^jobcan_[a-f0-9]{64}$/);
  assert.equal(booking.source, 'owner');
  assert.equal(booking.status, 'approved');
  assert.equal(booking.titlePublicAllowed, false);
  assert.equal(booking.titlePublic, false);
  assert.equal(booking.name, 'バイト');
  assert.equal(booking.title, 'バイト');
  assert.equal(booking.email, OWNER);
  assert.match(booking.approveToken, /^[a-f0-9]{48}$/);
  assert.equal(booking.syncOwnerKey, OWNER_KEY);
  const state = await getSyncState({ db: env.db, ownerEmail: OWNER, month: '2026-10' });
  assert.equal(state.lastNotificationId, 'gmail-1');
  assert.deepEqual(state.processedNotificationIds, ['gmail-1']);
  assert.equal(state.lastCounts.created, 1);
});

test('duplicate notifications and stale reordering produce no writes or duplicate booking', async () => {
  const env = setup();
  await sync(env);
  const writes = env.committedWrites;
  const duplicate = await sync(env);
  assert.equal(duplicate.reason, 'already_processed');
  const stale = await sync(env, { notification: notification('older', '2026-10-13T00:00:00.000Z') });
  assert.equal(stale.reason, 'stale_notification');
  const equalTimestamp = await sync(env, { notification: notification('same-time') });
  assert.equal(equalTimestamp.reason, 'stale_notification');
  assert.equal(env.committedWrites, writes);
  assert.equal(env.bookings().length, 1);
});

test('identical snapshot under a new notification remains one unchanged import', async () => {
  const env = setup();
  await sync(env);
  const before = env.bookings()[0];
  const result = await sync(env, { notification: notification('gmail-2', NOW) });
  assert.equal(result.created, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.unchanged, 1);
  assert.deepEqual(env.bookings()[0], before);
});

test('time correction preserves owner label, publication, creation time and capabilities', async () => {
  const env = setup();
  await sync(env);
  const before = env.bookings()[0];
  const path = `bookings/${before.id}`;
  env.records.set(path, { ...env.records.get(path), name: '私の変更名', title: '私の変更名', titlePublicAllowed: true, titlePublic: true });
  const result = await sync(env, {
    snapshot: snapshot([{ date: '2026-10-20', startTime: '17:15', endTime: '22:45' }]),
    notification: notification('gmail-2', NOW),
    label: '別の新規用ラベル',
  });
  assert.equal(result.updated, 1);
  const updated = env.bookings()[0];
  assert.equal(updated.id, before.id);
  assert.equal(updated.startTime, '17:15');
  assert.equal(updated.endTime, '22:45');
  assert.equal(updated.title, '私の変更名');
  assert.equal(updated.titlePublic, true);
  assert.equal(updated.titlePublicAllowed, true);
  assert.equal(updated.createdAt, before.createdAt);
  assert.equal(updated.approveToken, before.approveToken);
});

test('complete empty month cancels only future imported shifts and preserves past and unrelated data', async () => {
  const env = setup();
  await sync(env, { now: '2026-10-01T00:00:00.000Z', snapshot: snapshot([
    { date: '2026-10-10', startTime: '10:00', endTime: '15:00' },
    { date: '2026-10-20', startTime: '16:00', endTime: '21:00' },
  ]) });
  const visitor = { date: '2026-10-20', startTime: '16:00', endTime: '18:00', source: 'visitor', status: 'approved', title: '訪問者', titlePublic: true };
  const manual = { ...visitor, source: 'owner', title: '手入力' };
  env.records.set('bookings/visitor', visitor);
  env.records.set('bookings/manual', manual);
  env.records.set('bookings/other-account', { ...manual, syncProvider: 'jobcan', syncOwnerKey: 'someone-else', syncMonth: '2026-10' });
  env.records.set('bookings/other-month', { ...manual, date: '2026-11-20', syncProvider: 'jobcan', syncOwnerKey: OWNER_KEY, syncMonth: '2026-11' });
  const unrelated = new Map([...env.records].filter(([path]) => !path.startsWith('shiftSyncState/') && !path.startsWith('bookings/jobcan_')));
  const result = await sync(env, { snapshot: snapshot([]), notification: notification('gmail-2', NOW) });
  assert.equal(result.cancelled, 1);
  const imports = env.bookings().filter(row => row.id.startsWith('jobcan_'));
  assert.equal(imports.find(row => row.date === '2026-10-10').status, 'approved');
  assert.equal(imports.find(row => row.date === '2026-10-20').status, 'cancelled');
  for (const [path, data] of unrelated) assert.deepEqual(env.records.get(path), data);
});

test('past incoming shifts are skipped, including the Japan date boundary', async () => {
  const env = setup();
  const result = await sync(env, {
    now: '2026-10-14T15:00:00.000Z', // midnight Oct 15 JST
    snapshot: snapshot([
      { date: '2026-10-14', startTime: '22:00', endTime: '02:00' },
      { date: '2026-10-15', startTime: '16:00', endTime: '21:00' },
    ]),
  });
  assert.equal(result.skippedPast, 1);
  assert.equal(result.created, 1);
  assert.equal(env.bookings()[0].date, '2026-10-15');
});

test('overnight import crossing month boundary reports overlap and preserves manual and visitor bookings', async () => {
  const env = setup();
  const visitor = { date: '2026-11-01', startTime: '01:00', endTime: '03:00', source: 'visitor', status: 'pending' };
  const manual = { date: '2026-10-31', startTime: '21:00', endTime: '23:00', source: 'owner', status: 'approved' };
  env.records.set('bookings/visitor', visitor);
  env.records.set('bookings/manual', manual);
  env.records.set('bookings/adjacent-free', { ...visitor, startTime: '02:00', endTime: '03:00' });
  const result = await sync(env, { snapshot: snapshot([{ date: '2026-10-31', startTime: '22:00', endTime: '02:00' }]) });
  assert.equal(result.created, 1);
  assert.deepEqual(result.conflicts.map(conflict => conflict.bookingId).sort(), ['manual', 'visitor']);
  assert.deepEqual(env.records.get('bookings/visitor'), visitor);
  assert.deepEqual(env.records.get('bookings/manual'), manual);
  assert.equal(env.bookings().find(row => row.id.startsWith('jobcan_')).date, '2026-10-31');
});

test('deterministic ID and monthly state provenance collisions fail closed', async () => {
  const first = setup();
  await sync(first);
  const [bookingPath, bookingData] = [...first.records].find(([path]) => path.startsWith('bookings/'));
  const [statePath, stateData] = [...first.records].find(([path]) => path.startsWith('shiftSyncState/'));
  for (const change of [{ source: 'visitor' }, { syncProvider: 'manual' }, { syncOwnerKey: 'other' }, { syncMonth: '2026-11' }, { date: '2026-10-21' }]) {
    const env = setup();
    env.records.set(bookingPath, { ...bookingData, ...change });
    const original = structuredClone([...env.records]);
    await assert.rejects(sync(env), /Jobcan sync:/);
    assert.deepEqual([...env.records], original);
  }
  const env = setup();
  env.records.set(statePath, { ...stateData, syncOwnerKey: 'other' });
  await assert.rejects(sync(env), /state provenance/);
  assert.equal(env.committedWrites, 0);
});

test('dry run computes changes and conflicts without mutating bookings or monthly state', async () => {
  const env = setup();
  await sync(env);
  const original = structuredClone([...env.records]);
  const writes = env.committedWrites;
  const result = await sync(env, { snapshot: snapshot([]), notification: notification('gmail-2', NOW), dryRun: true });
  assert.equal(result.cancelled, 1);
  assert.equal(result.dryRun, true);
  assert.deepEqual([...env.records], original);
  assert.equal(env.committedWrites, writes);
});

test('failed commit cannot partially correct, cancel, create, or advance message state', async () => {
  const env = setup();
  await sync(env);
  const original = structuredClone([...env.records]);
  const writes = env.committedWrites;
  env.db.failCommit = true;
  await assert.rejects(sync(env, {
    snapshot: snapshot([{ date: '2026-10-21', startTime: '10:00', endTime: '16:00' }]),
    notification: notification('gmail-2', NOW),
  }), /simulated transaction commit failure/);
  assert.deepEqual([...env.records], original);
  assert.equal(env.committedWrites, writes);
  env.db.failCommit = false;
  const result = await sync(env, { snapshot: snapshot([{ date: '2026-10-21', startTime: '10:00', endTime: '16:00' }]), notification: notification('gmail-2', NOW) });
  assert.equal(result.created, 1);
  assert.equal(result.cancelled, 1);
});

test('transaction retry recomputes from current records and preserves concurrent publication change', async () => {
  const env = setup();
  await sync(env);
  const path = [...env.records.keys()].find(key => key.startsWith('bookings/'));
  env.db.retryFirst = true;
  env.db.afterFirstAttempt = async () => env.records.set(path, { ...env.records.get(path), titlePublicAllowed: true, titlePublic: true });
  const writes = env.committedWrites;
  const result = await sync(env, { snapshot: snapshot([{ date: '2026-10-20', startTime: '17:00', endTime: '22:00' }]), notification: notification('gmail-2', NOW) });
  assert.equal(result.updated, 1);
  assert.equal(env.attempts, 3);
  assert.equal(env.committedWrites - writes, 2);
  assert.equal(env.records.get(path).titlePublic, true);
  assert.equal(env.records.get(path).startTime, '17:00');
});

test('numeric Gmail internalDate and normalized owner email use the same sync identity', async () => {
  const env = setup();
  await sync(env, { ownerEmail: ' OWNER@EXAMPLE.TEST ', notification: notification('gmail-1', String(Date.parse('2026-10-14T12:00:00.000Z'))) });
  const state = await getSyncState({ db: env.db, ownerEmail: OWNER, month: '2026-10' });
  assert.equal(state.lastReceivedAt, '2026-10-14T12:00:00.000Z');
  assert.equal(env.bookings()[0].email, OWNER);
});
