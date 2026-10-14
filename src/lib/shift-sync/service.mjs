import { createHash, randomBytes } from 'node:crypto';
import { getSyncState, reconcileMonth, validateMonthSnapshot, LostLeaseError } from './sync.mjs';

export { LostLeaseError };

const LEASE_MILLISECONDS = 180000;
const FUTURE_TOLERANCE = 300000;
const MAX_MAIL_DELAY = 7 * 86400000;
const MAX_MONTH_AHEAD_DAYS = 180;
const SUBJECT_PATTERN = /^来月シフト確定のお知らせ(?:[\s　]*(?:じゃんぱら|\(じゃんぱら\)|（じゃんぱら）|\[じゃんぱら\]|【じゃんぱら】))?$/u;

export class BusyError extends Error {
  constructor() {
    super('Another worker is already fetching this owner’s Jobcan month');
    this.name = 'BusyError';
    this.code = 'SYNC_BUSY';
  }
}

function invalid(message) {
  const error = new Error(`Jobcan sync service: ${message}`);
  error.code = 'INVALID_NOTIFICATION';
  throw error;
}

function isoTimestamp(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    invalid(`${field} must be an ISO timestamp with a time zone`);
  }
  const datePart = value.slice(0, 10);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) invalid(`${field} has an invalid calendar date`);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > length || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) invalid(`${field} has an invalid calendar date`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) invalid(`${field} is invalid`);
  return new Date(timestamp).toISOString();
}

function nowFrom(clock) {
  const value = clock();
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) invalid('clock returned an invalid Date');
    return isoTimestamp(value.toISOString(), 'clock');
  }
  return isoTimestamp(value, 'clock');
}

function japanDate(timestamp) {
  return new Date(Date.parse(timestamp) + 9 * 3600000).toISOString().slice(0, 10);
}

function nextJapanMonth(timestamp) {
  const date = japanDate(timestamp);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

function validatedNotification(value, now) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('notification must be an object');
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(value.id)) invalid('Gmail message ID contains invalid characters or exceeds 512 characters');
  if (typeof value.subject !== 'string' || value.subject.length > 200 || !SUBJECT_PATTERN.test(value.subject.trim())) invalid('notification subject does not match the confirmed-shift email');
  const receivedAt = isoTimestamp(value.receivedAt, 'notification.receivedAt');
  if (Date.parse(receivedAt) > Date.parse(now) + FUTURE_TOLERANCE) invalid('notification.receivedAt is more than five minutes in the future');
  let sentAt;
  if (value.sentAt !== undefined) {
    sentAt = isoTimestamp(value.sentAt, 'notification.sentAt');
    const sent = Date.parse(sentAt);
    const received = Date.parse(receivedAt);
    if (sent > Date.parse(now) + FUTURE_TOLERANCE || sent > received + FUTURE_TOLERANCE || sent < received - MAX_MAIL_DELAY) {
      invalid('notification.sentAt is inconsistent with the receipt timestamp');
    }
  }
  const month = nextJapanMonth(sentAt ?? receivedAt);
  if (value.month !== undefined && value.month !== month) invalid('notification month does not match the next Japan month of its sent date');
  return { id: value.id, receivedAt, ...(sentAt ? { sentAt } : {}), subject: value.subject.trim(), month };
}

function priorResult(state, notification, dryRun) {
  const processed = state?.processedNotificationIds ?? [];
  if (processed.includes(notification.id) || state?.lastNotificationId === notification.id) {
    return { ok: true, persisted: !dryRun, dryRun, skipped: true, reason: 'already_processed', month: notification.month };
  }
  if (state?.lastReceivedAt && Date.parse(notification.receivedAt) <= Date.parse(isoTimestamp(state.lastReceivedAt, 'state.lastReceivedAt'))) {
    return { ok: true, persisted: !dryRun, dryRun, skipped: true, reason: 'stale_notification', month: notification.month };
  }
  return null;
}

function sanitizeResult(result, shifts) {
  return {
    ok: true,
    persisted: !result.dryRun,
    dryRun: result.dryRun,
    skipped: result.skipped,
    ...(result.reason ? { reason: result.reason } : {}),
    month: result.month,
    created: result.created,
    updated: result.updated,
    cancelled: result.cancelled,
    unchanged: result.unchanged,
    skippedPast: result.skippedPast,
    conflicts: result.conflicts.length,
    ...(result.dryRun ? { shifts } : {}),
  };
}

/** Cloud adapter: validate mail, serialize fetches, and commit behind a lease. */
export function createSyncService({ db, ownerEmail, fetchMonth, clock = () => new Date() }) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') invalid('db must support Firestore collections and transactions');
  if (typeof ownerEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())) invalid('ownerEmail is invalid');
  if (typeof fetchMonth !== 'function') invalid('fetchMonth must be a function');
  if (typeof clock !== 'function') invalid('clock must be a function');
  const email = ownerEmail.trim().toLowerCase();
  const ownerKey = createHash('sha256').update(email).digest('hex');

  async function releaseLease(ref, token) {
    await db.runTransaction(async transaction => {
      const doc = await transaction.get(ref);
      if (doc.exists && doc.data()?.token === token) transaction.delete(ref);
    });
  }

  async function acquireLease(ref, month) {
    const token = randomBytes(24).toString('hex');
    await db.runTransaction(async transaction => {
      const doc = await transaction.get(ref);
      const at = nowFrom(clock);
      if (doc.exists) {
        const existing = doc.data();
        if (typeof existing?.token !== 'string' || !existing.token) invalid('existing monthly lease is malformed');
        if (Date.parse(isoTimestamp(existing.expiresAt, 'lease.expiresAt')) > Date.parse(at)) throw new BusyError();
      }
      transaction.set(ref, {
        token,
        acquiredAt: at,
        expiresAt: new Date(Date.parse(at) + LEASE_MILLISECONDS).toISOString(),
        syncProvider: 'jobcan',
        syncOwnerKey: ownerKey,
        syncMonth: month,
      });
    });
    return token;
  }

  return {
    async sync({ notification: input, dryRun = false } = {}) {
      if (typeof dryRun !== 'boolean') invalid('dryRun must be a boolean');
      const at = nowFrom(clock);
      const notification = validatedNotification(input, at);
      const today = japanDate(at);
      if (notification.month < today.slice(0, 7)) {
        return { ok: true, persisted: false, dryRun, skipped: true, reason: 'old_month', month: notification.month };
      }
      const daysAhead = (Date.parse(`${notification.month}-01T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
      if (!Number.isFinite(daysAhead) || daysAhead > MAX_MONTH_AHEAD_DAYS) invalid('notification month exceeds the 180-day calendar horizon');
      const previous = priorResult(await getSyncState({ db, ownerEmail: email, month: notification.month }), notification, dryRun);
      if (previous) return previous;

      if (dryRun) {
        // Preview never acquires a lease or advances the Gmail state.
        const snapshot = validateMonthSnapshot(await fetchMonth(notification.month, { notification }));
        const result = await reconcileMonth({ db, snapshot, notification, ownerEmail: email, now: nowFrom(clock), dryRun: true });
        return sanitizeResult(result, snapshot.shifts);
      }

      const ref = db.collection('shiftSyncLocks').doc(`${ownerKey}_${notification.month}`);
      const token = await acquireLease(ref, notification.month);
      let originalError;
      try {
        // A prior worker can have completed between the initial read and lease.
        const previousAfterLease = priorResult(await getSyncState({ db, ownerEmail: email, month: notification.month }), notification, false);
        if (previousAfterLease) return previousAfterLease;
        const snapshot = validateMonthSnapshot(await fetchMonth(notification.month, { notification }));
        const result = await reconcileMonth({
          db, snapshot, notification, ownerEmail: email, now: nowFrom(clock),
          requiredLease: { token, clock },
        });
        return sanitizeResult(result, snapshot.shifts);
      } catch (error) {
        originalError = error;
        throw error;
      } finally {
        try {
          await releaseLease(ref, token);
        } catch (error) {
          // Keep the actual fetch/commit failure. A release failure otherwise
          // propagates so the caller knows this run needs a retry.
          if (!originalError) throw error;
        }
      }
    },
  };
}
