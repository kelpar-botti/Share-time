import { createHash, randomBytes } from 'node:crypto';

const PROVIDER = 'jobcan';
const BOOKING_COLLECTION = 'bookings';
const STATE_COLLECTION = 'shiftSyncState';
const ACTIVE_STATUSES = new Set(['pending', 'approved']);
const MAX_SHIFTS = 31;
const MAX_RECONCILIATION_DOCUMENTS = 100;

export class LostLeaseError extends Error {
  constructor(message = 'Jobcan synchronization lease was lost or expired') {
    super(message);
    this.name = 'LostLeaseError';
    this.code = 'SYNC_LEASE_LOST';
  }
}

function fail(message) {
  throw new Error(`Jobcan sync: ${message}`);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeOwnerEmail(value) {
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    fail('ownerEmail must be a valid email address');
  }
  return value.trim().toLowerCase();
}

function ownerKeyFor(email) {
  return hash(normalizeOwnerEmail(email));
}

function monthDates(month) {
  if (typeof month !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000-')) {
    fail('month must be a real YYYY-MM month');
  }
  const [year, number] = month.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][number - 1];
  return Array.from({ length }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

function minuteOfDay(time) {
  if (typeof time !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
    fail('shift times must use canonical 00:00 through 23:59');
  }
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

/** Reject incomplete pages before reconciliation can remove any calendar entry. */
export function validateMonthSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) fail('snapshot must be an object');
  const dates = monthDates(snapshot.month);
  const expected = new Set(dates);
  if (snapshot.complete !== true) fail('snapshot must explicitly confirm complete month coverage');
  if (!Array.isArray(snapshot.coveredDates) || snapshot.coveredDates.length !== dates.length) {
    fail('coveredDates must contain every calendar day exactly once');
  }
  const coverage = new Set(snapshot.coveredDates);
  if (coverage.size !== dates.length || snapshot.coveredDates.some(date => typeof date !== 'string' || !expected.has(date))) {
    fail('coveredDates contains missing, duplicate, invalid, or out-of-month days');
  }
  if (!Array.isArray(snapshot.shifts) || snapshot.shifts.length > MAX_SHIFTS) fail('shifts must contain at most one entry per day');
  const usedDates = new Set();
  const shifts = snapshot.shifts.map(shift => {
    if (!shift || typeof shift !== 'object' || !expected.has(shift.date)) fail('shift date is invalid or outside the complete month');
    if (usedDates.has(shift.date)) fail('multiple shifts on one day are unsupported; no calendar changes were made');
    usedDates.add(shift.date);
    const start = minuteOfDay(shift.startTime);
    const end = minuteOfDay(shift.endTime);
    if (start === end) fail('zero-length or 24-hour shifts are unsupported');
    // The calendar interprets an earlier end time as the following day.
    const duration = (end - start + 1440) % 1440;
    if (!(duration > 0 && duration < 1440)) fail('shift duration must be shorter than 24 hours');
    return { date: shift.date, startTime: shift.startTime, endTime: shift.endTime };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { month: snapshot.month, complete: true, coveredDates: dates, shifts };
}

function canonicalTimestamp(value, field) {
  let timestamp;
  if (typeof value === 'number' || (typeof value === 'string' && /^[0-9]{10,16}$/.test(value))) {
    timestamp = Number(value);
  } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    timestamp = Date.parse(value);
  } else {
    fail(`${field} must be an ISO timestamp or Gmail internalDate in milliseconds`);
  }
  if (!Number.isSafeInteger(timestamp) || !Number.isFinite(timestamp) || timestamp < 0) fail(`${field} is invalid`);
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) fail(`${field} is invalid`);
  return date.toISOString();
}

function normalizeNotification(notification, month) {
  if (!notification || typeof notification !== 'object' || typeof notification.id !== 'string' || !notification.id.trim() || notification.id.length > 512) {
    fail('notification must include a Gmail message ID');
  }
  if (notification.month !== month) fail('notification month does not match the Jobcan snapshot');
  if (typeof notification.subject !== 'string' || !notification.subject.trim()) fail('notification must include its subject');
  return {
    id: notification.id.trim(),
    receivedAt: canonicalTimestamp(notification.receivedAt, 'notification.receivedAt'),
    subject: notification.subject.trim().slice(0, 200),
    month,
  };
}

function ownsImport(data, ownerKey, month) {
  return data?.source === 'owner' && data.syncProvider === PROVIDER && data.syncOwnerKey === ownerKey && data.syncMonth === month;
}

function assertOwnedImport(doc, ownerKey, month) {
  const data = doc.data();
  if (!ownsImport(data, ownerKey, month)) fail(`booking collision or changed provenance at ${doc.id}`);
  if (typeof data.date !== 'string' || !monthDates(month).includes(data.date)) fail(`invalid imported date at ${doc.id}`);
  return data;
}

function shiftIdFor(ownerKey, date) {
  return `jobcan_${hash(`${ownerKey}\n${date}`)}`;
}

function absoluteRange(shift) {
  const day = Date.parse(`${shift.date}T00:00:00Z`) / 60000;
  const start = day + minuteOfDay(shift.startTime);
  let end = day + minuteOfDay(shift.endTime);
  if (end <= start) end += 1440;
  return [start, end];
}

function overlaps(first, second) {
  const [firstStart, firstEnd] = absoluteRange(first);
  const [secondStart, secondEnd] = absoluteRange(second);
  return firstStart < secondEnd && secondStart < firstEnd;
}

function adjacentDate(date, offset) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}

function stateRefFor(db, ownerKey, month) {
  return db.collection(STATE_COLLECTION).doc(`${ownerKey}_${month}`);
}

function assertStateProvenance(data, ownerKey, month) {
  if (!data) return;
  if (data.syncProvider !== PROVIDER || data.syncOwnerKey !== ownerKey || data.syncMonth !== month) fail('monthly state provenance does not match');
  if (data.processedNotificationIds !== undefined && (!Array.isArray(data.processedNotificationIds) || data.processedNotificationIds.some(id => typeof id !== 'string'))) {
    fail('monthly processed-notification state is invalid');
  }
}

export async function getSyncState({ db, ownerEmail, month }) {
  monthDates(month);
  const ownerKey = ownerKeyFor(ownerEmail);
  const doc = await stateRefFor(db, ownerKey, month).get();
  if (!doc.exists) return null;
  const data = doc.data();
  assertStateProvenance(data, ownerKey, month);
  return data;
}

/**
 * Reconcile only proven Jobcan owner entries, in one atomic monthly transaction.
 * The caller must serialize Jobcan fetches per account/month. Network fetching
 * and parsing belong outside this callback because Firestore may retry it.
 */
export async function reconcileMonth({ db, snapshot, notification, ownerEmail, label = 'バイト', now = new Date().toISOString(), dryRun = false, requiredLease = null }) {
  const checked = validateMonthSnapshot(snapshot);
  const event = normalizeNotification(notification, checked.month);
  const email = normalizeOwnerEmail(ownerEmail);
  const ownerKey = ownerKeyFor(email);
  const at = canonicalTimestamp(now, 'now');
  const today = new Date(Date.parse(at) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (typeof label !== 'string' || !label.trim() || label.trim().length > 100) fail('label must contain 1 to 100 characters');
  if (typeof dryRun !== 'boolean') fail('dryRun must be a boolean');
  if (requiredLease !== null && (typeof requiredLease !== 'object' || typeof requiredLease.token !== 'string' || !requiredLease.token || (requiredLease.clock !== undefined && typeof requiredLease.clock !== 'function'))) {
    fail('requiredLease must include a token and optional clock function');
  }
  const futureShifts = checked.shifts.filter(shift => shift.date >= today);
  const baseResult = {
    month: checked.month,
    notificationId: event.id,
    dryRun,
    skipped: false,
    created: 0,
    updated: 0,
    cancelled: 0,
    unchanged: 0,
    skippedPast: checked.shifts.length - futureShifts.length,
    conflicts: [],
  };
  const collection = db.collection(BOOKING_COLLECTION);
  const stateRef = stateRefFor(db, ownerKey, checked.month);
  const desired = futureShifts.map(shift => ({
    ...shift,
    id: shiftIdFor(ownerKey, shift.date),
    // Generate capabilities once, outside the retried transaction callback.
    approveToken: randomBytes(24).toString('hex'),
    rejectToken: randomBytes(24).toString('hex'),
  }));

  return db.runTransaction(async transaction => {
    // Read the lock in this same transaction, so another worker acquiring an
    // expired lease forces a retry instead of allowing a stale snapshot write.
    if (requiredLease) {
      const lock = await transaction.get(db.collection('shiftSyncLocks').doc(`${ownerKey}_${checked.month}`));
      const lease = lock.exists ? lock.data() : null;
      const clockValue = requiredLease.clock ? requiredLease.clock() : at;
      const leaseNow = canonicalTimestamp(clockValue instanceof Date ? clockValue.toISOString() : clockValue, 'lease clock');
      if (!lease || lease.token !== requiredLease.token || !lease.expiresAt || Date.parse(canonicalTimestamp(lease.expiresAt, 'lease.expiresAt')) <= Date.parse(leaseNow)) {
        throw new LostLeaseError();
      }
    }
    const stateDoc = await transaction.get(stateRef);
    const state = stateDoc.exists ? stateDoc.data() : null;
    assertStateProvenance(state, ownerKey, checked.month);
    const processed = state?.processedNotificationIds ?? [];
    if (processed.includes(event.id) || state?.lastNotificationId === event.id) {
      return { ...baseResult, skipped: true, reason: 'already_processed' };
    }
    if (state?.lastReceivedAt && Date.parse(event.receivedAt) <= Date.parse(canonicalTimestamp(state.lastReceivedAt, 'state.lastReceivedAt'))) {
      return { ...baseResult, skipped: true, reason: 'stale_notification' };
    }

    // Single-field queries work with Firestore's automatic indexes. Read every
    // desired deterministic ID too, to detect collisions outside the query.
    const imports = await transaction.get(collection.where('syncOwnerKey', '==', ownerKey));
    const importedDocs = imports.docs.filter(doc => {
      const data = doc.data();
      return data?.syncProvider === PROVIDER && data.syncMonth === checked.month;
    });
    if (importedDocs.length + desired.length > MAX_RECONCILIATION_DOCUMENTS) fail('monthly import exceeds the reconciliation document limit');
    const existing = new Map();
    for (const doc of importedDocs) existing.set(doc.id, { doc, data: assertOwnedImport(doc, ownerKey, checked.month) });
    const desiredDocs = new Map();
    for (const shift of desired) {
      const doc = await transaction.get(collection.doc(shift.id));
      if (doc.exists) assertOwnedImport(doc, ownerKey, checked.month);
      desiredDocs.set(shift.id, doc);
    }
    const [first, last] = [checked.coveredDates[0], checked.coveredDates.at(-1)];
    const nearby = desired.length === 0 ? { docs: [] } : await transaction.get(
      collection.where('date', '>=', adjacentDate(first, -1)).where('date', '<=', adjacentDate(last, 1))
    );

    // Compute every operation and warning before the first write.
    const result = { ...baseResult, conflicts: [] };
    const desiredIds = new Set(desired.map(shift => shift.id));
    const operations = [];
    for (const shift of desired) {
      const ref = collection.doc(shift.id);
      const doc = desiredDocs.get(shift.id);
      if (!doc.exists) {
        operations.push(['set', ref, {
          date: shift.date,
          startTime: shift.startTime,
          endTime: shift.endTime,
          name: label.trim(),
          email,
          message: '',
          title: label.trim(),
          titlePublicAllowed: false,
          titlePublic: false,
          status: 'approved',
          source: 'owner',
          approveToken: shift.approveToken,
          rejectToken: shift.rejectToken,
          titleToken: '',
          createdAt: at,
          updatedAt: at,
          syncProvider: PROVIDER,
          syncOwnerKey: ownerKey,
          syncMonth: checked.month,
        }]);
        result.created++;
      } else {
        const data = doc.data();
        if (data.date !== shift.date) fail(`deterministic booking date mismatch at ${shift.id}`);
        if (data.startTime !== shift.startTime || data.endTime !== shift.endTime || data.status !== 'approved') {
          operations.push(['update', ref, { startTime: shift.startTime, endTime: shift.endTime, status: 'approved', updatedAt: at }]);
          result.updated++;
        } else result.unchanged++;
      }
      for (const otherDoc of nearby.docs) {
        const other = otherDoc.data();
        // Imported records in this month are replaced/cancelled by this plan.
        // Manual owner and visitor records are only inspected, never changed.
        if (ownsImport(other, ownerKey, checked.month) || !ACTIVE_STATUSES.has(other?.status)) continue;
        try {
          if (overlaps(shift, other)) result.conflicts.push({ shiftId: shift.id, bookingId: otherDoc.id, date: shift.date, source: other.source ?? 'visitor' });
        } catch {
          // A malformed unrelated booking must not cause its replacement.
          result.conflicts.push({ shiftId: shift.id, bookingId: otherDoc.id, date: shift.date, source: other?.source ?? 'visitor', warning: 'existing_booking_time_invalid' });
        }
      }
    }
    for (const [id, imported] of existing) {
      if (imported.data.date < today || desiredIds.has(id) || imported.data.status === 'cancelled') continue;
      operations.push(['update', collection.doc(id), { status: 'cancelled', updatedAt: at }]);
      result.cancelled++;
    }
    if (dryRun) return result;
    for (const [kind, ref, data] of operations) transaction[kind](ref, data);
    const nextProcessed = [...processed, event.id].slice(-1000);
    transaction.set(stateRef, {
      syncProvider: PROVIDER,
      syncOwnerKey: ownerKey,
      syncMonth: checked.month,
      lastNotificationId: event.id,
      lastReceivedAt: event.receivedAt,
      lastNotificationSubject: event.subject,
      processedNotificationIds: nextProcessed,
      createdAt: state?.createdAt ?? at,
      lastSyncedAt: at,
      lastCounts: { created: result.created, updated: result.updated, cancelled: result.cancelled, unchanged: result.unchanged, skippedPast: result.skippedPast, conflicts: result.conflicts.length },
    });
    return result;
  });
}
