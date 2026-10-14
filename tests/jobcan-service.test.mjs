import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createSyncService, BusyError, LostLeaseError } from '../src/lib/shift-sync/service.mjs';

const OWNER = 'owner@example.test';
const OWNER_KEY = createHash('sha256').update(OWNER).digest('hex');
const LOCK_PATH = `shiftSyncLocks/${OWNER_KEY}_2026-10`;
const STATE_PATH = `shiftSyncState/${OWNER_KEY}_2026-10`;
const INITIAL_NOW = '2026-10-15T00:00:00.000Z';

function setup() {
  const records = new Map();
  const clone = value => value === undefined ? undefined : structuredClone(value);
  let gate = Promise.resolve();
  let committedWrites = 0;
  let attempts = 0;
  const snapshot = ref => ({ id: ref.id, exists: records.has(ref.path), data: () => clone(records.get(ref.path)) });
  function query(name, filters = []) {
    return {
      kind: 'query', name, filters,
      doc: id => {
        const ref = { kind: 'doc', id, path: `${name}/${id}`, get: async () => snapshot(ref) };
        return ref;
      },
      where: (field, operator, expected) => query(name, [...filters, [field, operator, expected]]),
    };
  }
  function read(ref) {
    if (ref.kind === 'doc') return snapshot(ref);
    return { docs: [...records].filter(([path, data]) => path.startsWith(`${ref.name}/`) && ref.filters.every(([field, operator, expected]) => {
      if (operator === '==') return data[field] === expected;
      if (operator === '>=') return data[field] >= expected;
      if (operator === '<=') return data[field] <= expected;
      throw new Error(`Unknown operator ${operator}`);
    })).map(([path]) => snapshot(query(ref.name).doc(path.slice(ref.name.length + 1)))) };
  }
  function signature(ref) {
    const current = read(ref);
    return ref.kind === 'doc' ? JSON.stringify({ exists: current.exists, data: current.data() }) : JSON.stringify(current.docs.map(doc => ({ id: doc.id, data: doc.data() })));
  }
  const db = {
    beforeCommit: null,
    failBookingCommit: false,
    collection: name => query(name),
    runTransaction: async callback => {
      // Serialize transactions while allowing the actual fetch to run outside.
      const previous = gate;
      let unlock;
      gate = new Promise(resolve => { unlock = resolve; });
      await previous;
      try {
        for (let retry = 0; retry < 3; retry++) {
          attempts++;
          const reads = [];
          const writes = [];
          const transaction = {
            get: async ref => {
              assert.equal(writes.length, 0, 'every Firestore read must precede writes');
              reads.push([ref, signature(ref)]);
              return read(ref);
            },
            set: (ref, data) => writes.push({ kind: 'set', ref, data: clone(data) }),
            update: (ref, data) => writes.push({ kind: 'update', ref, data: clone(data) }),
            delete: ref => writes.push({ kind: 'delete', ref }),
          };
          const result = await callback(transaction);
          if (db.beforeCommit) await db.beforeCommit(writes);
          if (reads.some(([ref, original]) => signature(ref) !== original)) continue;
          if (db.failBookingCommit && writes.some(write => write.ref.path.startsWith('bookings/'))) throw new Error('simulated booking commit failure');
          const next = new Map(records);
          for (const write of writes) {
            if (write.kind === 'delete') next.delete(write.ref.path);
            else if (write.kind === 'update') {
              assert.ok(next.has(write.ref.path));
              next.set(write.ref.path, { ...clone(next.get(write.ref.path)), ...write.data });
            } else next.set(write.ref.path, write.data);
          }
          records.clear();
          for (const entry of next) records.set(...entry);
          committedWrites += writes.length;
          return result;
        }
        throw new Error('transaction retry limit reached');
      } finally {
        unlock();
      }
    },
  };
  let time = INITIAL_NOW;
  return {
    db, records,
    get committedWrites() { return committedWrites; },
    get attempts() { return attempts; },
    clock: () => time,
    setTime: value => { time = value; },
    service: fetchMonth => createSyncService({ db, ownerEmail: OWNER, fetchMonth, clock: () => time }),
  };
}

function mail(overrides = {}) {
  return { id: 'gmail_1', receivedAt: '2026-09-27T09:00:00.000Z', subject: '来月シフト確定のお知らせ', month: '2026-10', ...overrides };
}

function monthSnapshot(month = '2026-10') {
  const [year, number] = month.split('-').map(Number);
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return {
    month, complete: true,
    coveredDates: Array.from({ length }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`),
    shifts: [{ date: `${month}-20`, startTime: '17:00', endTime: '22:00' }],
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('strict malformed notifications are rejected before database writes or network access', async () => {
  const cases = [
    mail({ id: '' }), mail({ id: 'contains spaces' }), mail({ id: 'x'.repeat(513) }), mail({ id: '../gmail' }),
    mail({ receivedAt: '1758963600000' }), mail({ receivedAt: '2026-09-31T09:00:00Z' }),
    mail({ receivedAt: '2026-10-15T00:05:01Z' }), mail({ subject: '来月シフト申請のお知らせ' }),
    mail({ subject: '来月シフト確定のお知らせ altered' }), mail({ month: '2026-11' }),
    mail({ sentAt: '2026-09-19T08:59:59Z' }), mail({ sentAt: '2026-09-27T09:05:01Z' }),
    mail({ sentAt: '2026-10-15T00:05:01Z' }),
  ];
  for (const notification of cases) {
    const env = setup();
    let fetches = 0;
    const service = env.service(async () => { fetches++; return monthSnapshot(); });
    await assert.rejects(service.sync({ notification }), /Jobcan sync service:/);
    assert.equal(env.committedWrites, 0);
    assert.equal(env.records.size, 0);
    assert.equal(fetches, 0);
  }
});

test('subject suffixes match strictly and sent date takes precedence over receipt month', async () => {
  for (const suffix of ['', ' じゃんぱら', '（じゃんぱら）', ' [じゃんぱら]']) {
    const env = setup();
    let fetchedMonth;
    const service = env.service(async month => { fetchedMonth = month; return monthSnapshot(month); });
    const result = await service.sync({
      notification: mail({
        subject: `来月シフト確定のお知らせ${suffix}`,
        sentAt: '2026-09-30T14:59:59Z',
        receivedAt: '2026-09-30T15:00:01Z', // Oct 1 JST received, Sept 30 sent
      }),
    });
    assert.equal(fetchedMonth, '2026-10');
    assert.equal(result.persisted, true);
    assert.equal(env.records.has(LOCK_PATH), false);
  }
});

test('JST next-month derivation handles year end and optional supplied month', async () => {
  const env = setup();
  env.setTime('2026-12-31T15:00:00Z');
  let fetchedMonth;
  const service = env.service(async month => { fetchedMonth = month; return monthSnapshot(month); });
  const notification = mail({ receivedAt: '2026-12-31T14:59:59Z', month: undefined });
  const result = await service.sync({ notification, dryRun: true });
  assert.equal(fetchedMonth, '2027-01');
  assert.equal(result.month, '2027-01');
  assert.equal(env.committedWrites, 0);
});

test('old month skips without fetching or writing and malformed month still rejects', async () => {
  const env = setup();
  let fetches = 0;
  const service = env.service(async () => { fetches++; return monthSnapshot(); });
  const result = await service.sync({ notification: mail({ receivedAt: '2026-08-25T00:00:00Z', month: '2026-09' }) });
  assert.equal(result.reason, 'old_month');
  assert.equal(result.persisted, false);
  assert.equal(fetches, 0);
  assert.equal(env.committedWrites, 0);
  await assert.rejects(service.sync({ notification: mail({ month: '2026-13' }) }), /month does not match/);
});

test('cloud run acquires/releases lease and returns counts without capabilities or personal data', async () => {
  const env = setup();
  let fetches = 0;
  const service = env.service(async (month, context) => {
    fetches++;
    assert.equal(month, '2026-10');
    assert.equal(context.notification.id, 'gmail_1');
    assert.ok(env.records.get(LOCK_PATH).token);
    return monthSnapshot();
  });
  const result = await service.sync({ notification: mail() });
  assert.equal(result.ok, true);
  assert.equal(result.persisted, true);
  assert.equal(result.created, 1);
  assert.equal(result.conflicts, 0);
  assert.equal('shifts' in result, false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /approveToken|rejectToken|syncOwnerKey|owner@example|gmail_1/);
  assert.equal(env.records.has(LOCK_PATH), false);
  const writes = env.committedWrites;
  const duplicate = await service.sync({ notification: mail() });
  assert.equal(duplicate.reason, 'already_processed');
  assert.equal(duplicate.persisted, true);
  const stale = await service.sync({ notification: mail({ id: 'gmail_old', receivedAt: '2026-09-26T09:00:00Z' }) });
  assert.equal(stale.reason, 'stale_notification');
  assert.equal(stale.persisted, true);
  assert.equal(fetches, 1);
  assert.equal(env.committedWrites, writes);
});

test('concurrent pending fetches allow only one owner/month lease acquisition', async () => {
  const env = setup();
  const entered = deferred();
  const finish = deferred();
  let fetches = 0;
  const service = env.service(async () => {
    fetches++;
    entered.resolve();
    await finish.promise;
    return monthSnapshot();
  });
  const first = service.sync({ notification: mail() });
  await entered.promise;
  await assert.rejects(service.sync({ notification: mail({ id: 'gmail_2', receivedAt: '2026-09-28T09:00:00Z' }) }), error => error instanceof BusyError && error.code === 'SYNC_BUSY');
  assert.equal(fetches, 1);
  finish.resolve();
  assert.equal((await first).created, 1);
  assert.equal(env.records.has(LOCK_PATH), false);
});

test('lease stolen while fetching prevents booking/state writes and release preserves replacement', async () => {
  const env = setup();
  const stolen = { token: 'replacement-worker', expiresAt: '2026-10-15T00:10:00Z' };
  const service = env.service(async () => {
    env.records.set(LOCK_PATH, stolen);
    return monthSnapshot();
  });
  await assert.rejects(service.sync({ notification: mail() }), error => error instanceof LostLeaseError && error.code === 'SYNC_LEASE_LOST');
  assert.deepEqual(env.records.get(LOCK_PATH), stolen);
  assert.equal(env.records.has(STATE_PATH), false);
  assert.equal([...env.records.keys()].some(key => key.startsWith('bookings/')), false);
  assert.equal(env.committedWrites, 1); // only this worker's initial acquisition
});

test('expired lease after slow fetch cannot commit and releases only its own lease', async () => {
  const env = setup();
  const service = env.service(async () => {
    env.setTime('2026-10-15T00:03:00.001Z');
    return monthSnapshot();
  });
  await assert.rejects(service.sync({ notification: mail() }), LostLeaseError);
  assert.equal(env.records.has(LOCK_PATH), false);
  assert.equal(env.records.has(STATE_PATH), false);
  assert.equal([...env.records.keys()].some(key => key.startsWith('bookings/')), false);
});

test('lease stolen between transactional assertion and commit forces retry then fails closed', async () => {
  const env = setup();
  const stolen = { token: 'newer-worker', expiresAt: '2026-10-15T00:10:00Z' };
  const service = env.service(async () => {
    env.db.beforeCommit = writes => {
      if (!writes.some(write => write.ref.path.startsWith('bookings/'))) return;
      env.db.beforeCommit = null;
      env.records.set(LOCK_PATH, stolen);
    };
    return monthSnapshot();
  });
  await assert.rejects(service.sync({ notification: mail() }), LostLeaseError);
  assert.deepEqual(env.records.get(LOCK_PATH), stolen);
  assert.equal(env.records.has(STATE_PATH), false);
  assert.equal([...env.records.keys()].some(key => key.startsWith('bookings/')), false);
  assert.ok(env.attempts >= 4); // acquisition, reconcile twice, conditional release
});

test('state is rechecked after lease acquisition before fetching', async () => {
  const env = setup();
  let fetches = 0;
  let injected = false;
  env.db.beforeCommit = writes => {
    if (injected || !writes.some(write => write.ref.path === LOCK_PATH && write.kind === 'set')) return;
    injected = true;
    env.records.set(STATE_PATH, {
      syncProvider: 'jobcan', syncOwnerKey: OWNER_KEY, syncMonth: '2026-10',
      lastNotificationId: 'gmail_1', lastReceivedAt: '2026-09-27T09:00:00.000Z', processedNotificationIds: ['gmail_1'],
    });
  };
  const service = env.service(async () => { fetches++; return monthSnapshot(); });
  const result = await service.sync({ notification: mail() });
  assert.equal(result.reason, 'already_processed');
  assert.equal(fetches, 0);
  assert.equal(env.records.has(LOCK_PATH), false);
});

test('dry run returns shift preview and counts without lease, booking, or state writes', async () => {
  const env = setup();
  const service = env.service(async () => {
    assert.equal(env.records.has(LOCK_PATH), false);
    return monthSnapshot();
  });
  const result = await service.sync({ notification: mail(), dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.persisted, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.created, 1);
  assert.deepEqual(result.shifts, monthSnapshot().shifts);
  assert.equal(env.committedWrites, 0);
  assert.equal(env.records.size, 0);
});

test('fetch, parsing, and transaction failures release lease without advancing Gmail state', async () => {
  for (const mode of ['fetch', 'parse', 'month', 'commit']) {
    const env = setup();
    if (mode === 'commit') env.db.failBookingCommit = true;
    const service = env.service(async () => {
      if (mode === 'fetch') throw new Error('Jobcan unavailable');
      if (mode === 'parse') return { ...monthSnapshot(), complete: false };
      if (mode === 'month') return monthSnapshot('2026-11');
      return monthSnapshot();
    });
    await assert.rejects(service.sync({ notification: mail() }));
    assert.equal(env.records.has(LOCK_PATH), false);
    assert.equal(env.records.has(STATE_PATH), false);
    assert.equal([...env.records.keys()].some(key => key.startsWith('bookings/')), false);
  }
});

test('an expired previous worker lease can be replaced and successfully completed', async () => {
  const env = setup();
  env.records.set(LOCK_PATH, { token: 'expired-worker', expiresAt: '2026-10-14T23:59:59Z' });
  const result = await env.service(async () => monthSnapshot()).sync({ notification: mail() });
  assert.equal(result.created, 1);
  assert.equal(env.records.has(LOCK_PATH), false);
  assert.equal(env.records.get(STATE_PATH).lastNotificationId, 'gmail_1');
});
