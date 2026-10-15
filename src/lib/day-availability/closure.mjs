import { createHash, randomUUID } from 'node:crypto';

const DAY_MS = 86400000;
const GUARDS = 'dayAvailability';
const SUGGESTIONS = 'scheduleSuggestions';
const BLOCKING = new Set(['pending', 'approved']);

export class DayClosureError extends Error {
  constructor(code, message) { super(message); this.name = 'DayClosureError'; this.code = code; }
}
export class RangeUnavailableError extends DayClosureError {
  constructor(reason = 'closed') { super(reason, reason === 'closed' ? 'この日は新しい予約の受付を停止しています。' : 'この時間はすでに予定が入っています。'); }
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 100) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(+parsed) && parsed.toISOString().slice(0, 10) === value;
}
function requireDate(value) {
  if (!validDate(value)) throw new DayClosureError('invalid_date', '有効な日付を選択してください。');
  return value;
}
function addDay(date, delta) { return new Date(Date.parse(`${date}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10); }
function minutes(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new DayClosureError('invalid_time', '時刻が正しくありません。');
  const [h, m] = value.split(':').map(Number); return h * 60 + m;
}
function absoluteRange(range) {
  requireDate(range.date);
  const day = Date.parse(`${range.date}T00:00:00Z`) / 60000;
  const start = minutes(range.startTime); let end = minutes(range.endTime);
  if (end <= start) end += 1440;
  return [day + start, day + end];
}
function overlaps(a, b) { const [as, ae] = absoluteRange(a); const [bs, be] = absoluteRange(b); return as < be && bs < ae; }

/** Actual occupied dates in [start,end). A midnight end does not occupy the next day. */
export function occupiedDates(range) {
  absoluteRange(range);
  return minutes(range.endTime) <= minutes(range.startTime) && minutes(range.endTime) > 0
    ? [range.date, addDay(range.date, 1)] : [range.date];
}

function publicDay(date, data) { return { date, closed: data?.closed === true }; }
export async function getDayAvailability(db, date) {
  requireDate(date);
  const snapshot = await db.collection(GUARDS).doc(date).get();
  return publicDay(date, snapshot.data());
}
export async function getDayAvailabilityRange(db, startDate, endDate) {
  requireDate(startDate); requireDate(endDate);
  const span = (Date.parse(endDate) - Date.parse(startDate)) / DAY_MS;
  if (span < 0 || span > 370) throw new DayClosureError('invalid_range', '日付の範囲が正しくありません。');
  const snapshots = await Promise.all(Array.from({ length: span + 1 }, (_, i) => {
    const date = addDay(startDate, i);
    return getDayAvailability(db, date);
  }));
  return snapshots;
}

/** Read all guards and conflicts before any writes. Reused by every visitor write path. */
export async function readVisitorRangeGuard({ transaction, db, range, excludeBookingId }) {
  const guards = [];
  for (const date of occupiedDates(range)) {
    const ref = db.collection(GUARDS).doc(date);
    const data = (await transaction.get(ref)).data();
    if (data?.closed === true) throw new RangeUnavailableError('closed');
    guards.push({ ref, date, data });
  }
  const nearby = await transaction.get(db.collection('bookings').where('date', '>=', addDay(range.date, -1)).where('date', '<=', addDay(range.date, 1)));
  for (const doc of nearby.docs) {
    const booking = doc.data();
    if (doc.id !== excludeBookingId && BLOCKING.has(booking.status) && overlaps(booking, range)) throw new RangeUnavailableError('taken');
  }
  return guards;
}

/** Writing the same guard docs makes booking/closure and competing booking transactions serialize. */
export function touchVisitorRangeGuard(transaction, guards, now) {
  for (const { ref, date, data } of guards) transaction.set(ref, {
    ...data, date, closed: data?.closed === true, revision: (data?.revision ?? 0) + 1, updatedAt: now,
  });
}

function normalizeDates(dates, allowEmpty = false) {
  if (!Array.isArray(dates) || dates.length > 31 || (!allowEmpty && dates.length === 0)) throw new DayClosureError('invalid_dates', '受付停止する日を選択してください。');
  return [...new Set(dates.map(requireDate))].sort();
}
function boundedText(value, max, field, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) throw new DayClosureError('invalid_input', `${field}が正しくありません。`);
  return value.trim();
}
function suggestionId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new DayClosureError('invalid_id', '提案が見つかりません。');
  return value;
}

/** Authentication stays in the caller. ownerEmail must come from the server's authorized admin session. */
export function createClosureService({ db, ownerEmail, clock = () => new Date() }) {
  if (typeof ownerEmail !== 'string' || !ownerEmail.includes('@')) throw new DayClosureError('owner_required', '管理者の認証が必要です。');
  const ownerKey = createHash('sha256').update(ownerEmail.trim().toLowerCase()).digest('hex');
  const now = () => {
    const value = new Date(clock());
    if (Number.isNaN(+value)) throw new DayClosureError('invalid_clock', '時刻を確認できません。');
    return value.toISOString();
  };
  const owned = (doc) => {
    const data = doc.data();
    if (!data || data.ownerKey !== ownerKey) throw new DayClosureError('not_found', '提案が見つかりません。');
    return { id: doc.id, ...data };
  };
  const getSuggestion = async id => owned(await db.collection(SUGGESTIONS).doc(suggestionId(id)).get());
  return {
    getSuggestion,
    async listSuggestions() {
      const snap = await db.collection(SUGGESTIONS).where('ownerKey', '==', ownerKey).get();
      return snap.docs.map(owned).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async createSuggestion(input) {
      const id = suggestionId(input.id ?? randomUUID());
      const dates = normalizeDates(input.dates ?? [], true);
      const summary = boundedText(input.summary, 500, '予定');
      const evidence = boundedText(input.evidence, 2000, '会話の抜粋', true);
      if (!['line', 'discord', 'manual'].includes(input.source)) throw new DayClosureError('invalid_source', '取り込み元が正しくありません。');
      const confidence = input.confidence ?? 'medium';
      if (!['high', 'medium', 'low'].includes(confidence)) throw new DayClosureError('invalid_confidence', '確度が正しくありません。');
      const ref = db.collection(SUGGESTIONS).doc(id);
      return db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        if (snap.exists) return owned(snap); // Client retries cannot create duplicate or reset a decision.
        const timestamp = now();
        const data = { ownerKey, dates, summary, evidence, source: input.source, confidence, status: 'pending', createdAt: timestamp, updatedAt: timestamp };
        transaction.set(ref, data);
        return { id, ...data };
      });
    },
    async acceptSuggestion(id, selectedDates) {
      const ref = db.collection(SUGGESTIONS).doc(suggestionId(id));
      return db.runTransaction(async transaction => {
        const proposal = owned(await transaction.get(ref));
        const dates = normalizeDates(selectedDates ?? proposal.acceptedDates ?? proposal.dates);
        if (proposal.status === 'accepted') {
          if (JSON.stringify(dates) !== JSON.stringify(proposal.acceptedDates)) throw new DayClosureError('already_handled', '確定済みの提案です。');
          return { suggestion: proposal, changed: false, existingBookingCount: proposal.existingBookingCount ?? 0 };
        }
        if (proposal.status !== 'pending') throw new DayClosureError('already_handled', 'この提案は見送り済みです。');
        const timestamp = now();
        const today = new Date(Date.parse(timestamp) + 9 * 3600000).toISOString().slice(0, 10);
        if (dates.some(date => date < today || (Date.parse(date) - Date.parse(today)) / DAY_MS > 365)) throw new DayClosureError('invalid_dates', '本日から365日以内の日付を選択してください。');
        const guards = [];
        for (const date of dates) {
          const guardRef = db.collection(GUARDS).doc(date);
          guards.push({ ref: guardRef, date, data: (await transaction.get(guardRef)).data() });
        }
        const bookings = await transaction.get(db.collection('bookings').where('date', '>=', addDay(dates[0], -1)).where('date', '<=', dates.at(-1)));
        const existingBookingCount = bookings.docs.filter(doc => {
          const booking = doc.data();
          return BLOCKING.has(booking.status) && occupiedDates(booking).some(date => dates.includes(date));
        }).length;
        for (const guard of guards) transaction.set(guard.ref, {
          ...guard.data, date: guard.date, closed: true,
          proposalIds: [...new Set([...(guard.data?.proposalIds ?? []), id])],
          revision: (guard.data?.revision ?? 0) + 1, updatedAt: timestamp,
        });
        const update = { status: 'accepted', acceptedDates: dates, existingBookingCount, acceptedAt: timestamp, updatedAt: timestamp };
        transaction.update(ref, update);
        return { suggestion: { ...proposal, ...update }, changed: true, existingBookingCount };
      });
    },
    async dismissSuggestion(id) {
      const ref = db.collection(SUGGESTIONS).doc(suggestionId(id));
      return db.runTransaction(async transaction => {
        const proposal = owned(await transaction.get(ref));
        if (proposal.status === 'dismissed') return { suggestion: proposal, changed: false };
        if (proposal.status !== 'pending') throw new DayClosureError('already_handled', '確定済みの提案です。');
        const update = { status: 'dismissed', updatedAt: now() };
        transaction.update(ref, update);
        return { suggestion: { ...proposal, ...update }, changed: true };
      });
    },
    getDayAvailability: date => getDayAvailability(db, date),
    getDayAvailabilityRange: (start, end) => getDayAvailabilityRange(db, start, end),
  };
}
