import "server-only";
import { randomBytes } from "crypto";
import { getDb } from "./firebase-admin";
import { addDays, crossesMidnight, timeToMinutes, toAbsoluteMinutes } from "./date";
import type { Booking, BookingSource, BookingStatus } from "./types";

const COLLECTION = "bookings";

// Statuses that hold a range as unavailable to other visitors.
const BLOCKING_STATUSES: BookingStatus[] = ["pending", "approved"];

function generateToken(): string {
  return randomBytes(24).toString("hex");
}

function docToBooking(
  doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
): Booking {
  const data = doc.data()!;
  return {
    id: doc.id,
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    name: data.name,
    email: data.email,
    message: data.message ?? "",
    status: data.status,
    source: data.source ?? "visitor",
    approveToken: data.approveToken,
    rejectToken: data.rejectToken,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

type TimeRangeLike = { date: string; startTime: string; endTime: string };

/** Absolute [start, end) in minutes since a fixed epoch, rolling into the next day if the range crosses midnight. */
function toAbsoluteRange(r: TimeRangeLike): [number, number] {
  const start = toAbsoluteMinutes(r.date, r.startTime);
  const end = toAbsoluteMinutes(r.date, r.endTime);
  return [start, end <= start ? end + 24 * 60 : end];
}

function rangesOverlap(a: TimeRangeLike, b: TimeRangeLike): boolean {
  const [aStart, aEnd] = toAbsoluteRange(a);
  const [bStart, bEnd] = toAbsoluteRange(b);
  return aStart < bEnd && bStart < aEnd;
}

/** Splits a booking's duration across the calendar date(s) it actually occupies (two if it crosses midnight). */
export function splitBookingMinutesByDate(b: TimeRangeLike): { date: string; minutes: number }[] {
  if (!crossesMidnight(b.startTime, b.endTime)) {
    return [{ date: b.date, minutes: timeToMinutes(b.endTime) - timeToMinutes(b.startTime) }];
  }
  return [
    { date: b.date, minutes: 24 * 60 - timeToMinutes(b.startTime) },
    { date: addDays(b.date, 1), minutes: timeToMinutes(b.endTime) },
  ];
}

/**
 * Bookings for one date, filtered client-side (in this process, not Firestore)
 * rather than with a compound Firestore query, so no composite index needs to
 * be created in the Firebase console for this app to work.
 */
export async function getActiveBookingsForDate(date: string): Promise<Booking[]> {
  const snap = await getDb().collection(COLLECTION).where("date", "==", date).get();
  return snap.docs.map(docToBooking).filter((b) => BLOCKING_STATUSES.includes(b.status));
}

/**
 * Bookings across a date range (inclusive), for the month-overview heatmap.
 * Both filters are on the same field ("date"), which Firestore covers with
 * its automatic single-field index — no composite index to set up.
 */
export async function getActiveBookingsForDateRange(
  startDate: string,
  endDate: string
): Promise<Booking[]> {
  const snap = await getDb()
    .collection(COLLECTION)
    .where("date", ">=", startDate)
    .where("date", "<=", endDate)
    .get();
  return snap.docs.map(docToBooking).filter((b) => BLOCKING_STATUSES.includes(b.status));
}

/**
 * Whether [date startTime, endTime) is free of any pending/approved booking.
 * A booking can cross at most one midnight (see `crossesMidnight`), so any
 * conflict must involve a booking starting the day before, the same day, or
 * the day after — that 3-day window is all this needs to check.
 */
export async function isRangeAvailable(
  date: string,
  startTime: string,
  endTime: string
): Promise<boolean> {
  const nearby = await getActiveBookingsForDateRange(addDays(date, -1), addDays(date, 1));
  const candidate: TimeRangeLike = { date, startTime, endTime };
  return !nearby.some((b) => rangesOverlap(b, candidate));
}

export interface VisibleBooking extends Booking {
  /** Started the previous day and spills into this date's early hours. */
  carriesFromPreviousDay: boolean;
  /** Starts this date but doesn't end until after midnight. */
  spillsIntoNextDay: boolean;
}

/** Bookings a visitor viewing `date` needs to see, including overnight carryover from the day before. */
export async function getBookingsVisibleOnDate(date: string): Promise<VisibleBooking[]> {
  const [todays, prevs] = await Promise.all([
    getActiveBookingsForDate(date),
    getActiveBookingsForDate(addDays(date, -1)),
  ]);

  const carryovers: VisibleBooking[] = prevs
    .filter((b) => crossesMidnight(b.startTime, b.endTime))
    .map((b) => ({ ...b, carriesFromPreviousDay: true, spillsIntoNextDay: false }));

  const current: VisibleBooking[] = todays.map((b) => ({
    ...b,
    carriesFromPreviousDay: false,
    spillsIntoNextDay: crossesMidnight(b.startTime, b.endTime),
  }));

  const displayStart = (b: VisibleBooking) => (b.carriesFromPreviousDay ? 0 : timeToMinutes(b.startTime));
  return [...carryovers, ...current].sort((a, b) => displayStart(a) - displayStart(b));
}

export async function createBookingRequest(input: {
  date: string;
  startTime: string;
  endTime: string;
  name: string;
  email: string;
  message: string;
}): Promise<Booking> {
  const now = new Date().toISOString();
  const ref = getDb().collection(COLLECTION).doc();
  const data = {
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    name: input.name,
    email: input.email,
    message: input.message,
    status: "pending" as BookingStatus,
    source: "visitor" as BookingSource,
    approveToken: generateToken(),
    rejectToken: generateToken(),
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(data);
  return { id: ref.id, ...data };
}

/**
 * The admin blocking off their own time directly (e.g. a part-time job
 * shift) — auto-approved immediately, no visitor and no approval email.
 */
export async function createOwnerBlock(input: {
  date: string;
  startTime: string;
  endTime: string;
  label: string;
}): Promise<Booking> {
  const now = new Date().toISOString();
  const ref = getDb().collection(COLLECTION).doc();
  const data = {
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    name: input.label,
    email: process.env.ADMIN_EMAIL ?? "",
    message: "",
    status: "approved" as BookingStatus,
    source: "owner" as BookingSource,
    approveToken: generateToken(),
    rejectToken: generateToken(),
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(data);
  return { id: ref.id, ...data };
}

export async function getBooking(id: string): Promise<Booking | null> {
  const doc = await getDb().collection(COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return docToBooking(doc);
}

type RespondResult =
  | { ok: true; status: BookingStatus }
  | { ok: false; reason: "not_found" | "invalid_token" }
  | { ok: false; reason: "already_handled"; status: BookingStatus };

export async function respondToBookingByToken(
  id: string,
  token: string,
  action: "approve" | "reject"
): Promise<RespondResult> {
  const ref = getDb().collection(COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return { ok: false, reason: "not_found" };

  const data = doc.data()!;
  const expectedToken = action === "approve" ? data.approveToken : data.rejectToken;
  if (!expectedToken || expectedToken !== token) {
    return { ok: false, reason: "invalid_token" };
  }
  if (data.status !== "pending") {
    return { ok: false, reason: "already_handled", status: data.status };
  }

  const status: BookingStatus = action === "approve" ? "approved" : "rejected";
  await ref.update({ status, updatedAt: new Date().toISOString() });
  return { ok: true, status };
}

export async function setBookingStatus(id: string, status: BookingStatus): Promise<void> {
  await getDb()
    .collection(COLLECTION)
    .doc(id)
    .update({ status, updatedAt: new Date().toISOString() });
}

/** All bookings, sorted by date/time; grouping into pending/history is left to the caller. */
export async function listBookings(opts?: { source?: BookingSource }): Promise<Booking[]> {
  const snap = await getDb().collection(COLLECTION).get();
  let bookings = snap.docs.map(docToBooking);
  if (opts?.source) {
    bookings = bookings.filter((b) => b.source === opts.source);
  }
  bookings.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  return bookings;
}
