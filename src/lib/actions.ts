"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { signOut } from "@/auth";
import { requireAdmin } from "./admin";
import {
  createBookingRequest,
  createOwnerBlock,
  getBooking,
  isRangeAvailable,
  setBookingStatus,
  setTitleVisibility,
} from "./bookings";
import { sendBookingDecisionEmail, sendBookingRequestEmail } from "./mailer";
import {
  daysFromToday,
  enumerateDates,
  generateTimeOptions,
  getWeekday,
  isValidDateString,
  isValidTimeString,
  MAX_DAYS_AHEAD,
  MAX_SCHEDULE_RANGE_DAYS,
  OWNER_MAX_DAYS_AHEAD,
} from "./date";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Not a real content restriction — the form has no visible limit — just a
// generous server-side ceiling so a raw POST can't write an unbounded blob.
const MESSAGE_MAX_LENGTH = 20000;
const TITLE_MAX_LENGTH = 100;

// Notification emails are a courtesy, not the source of truth — the booking
// status change in Firestore already happened by the time we send one. If
// Gmail is briefly unreachable or misconfigured, that must not make the
// visitor/admin think their approve/reject/request action itself failed.
async function sendEmailSafely(send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (error) {
    console.error("メール送信に失敗しました:", error);
  }
}

export async function submitBookingRequest(formData: FormData): Promise<void> {
  const date = String(formData.get("date") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const titlePublicAllowed = formData.get("allowPublicTitle") === "on";
  const honeypot = String(formData.get("company") ?? "").trim();

  const backToForm = (error: string) =>
    redirect(
      `/book?date=${encodeURIComponent(date)}&start=${encodeURIComponent(startTime)}&end=${encodeURIComponent(endTime)}&error=${error}`
    );
  const toDone = () =>
    redirect(
      `/book/done?date=${encodeURIComponent(date)}&start=${encodeURIComponent(startTime)}&end=${encodeURIComponent(endTime)}`
    );

  // Bots that fill every field (including the hidden honeypot) are quietly
  // sent to the "done" screen instead of an error, so they can't tell they
  // were filtered out.
  if (honeypot) {
    toDone();
  }

  if (!isValidDateString(date)) {
    redirect("/");
  }
  const offset = daysFromToday(date);
  if (offset < 0 || offset > MAX_DAYS_AHEAD) {
    redirect("/");
  }

  const validTimes = new Set(generateTimeOptions());
  if (
    !isValidTimeString(startTime) ||
    !isValidTimeString(endTime) ||
    !validTimes.has(startTime) ||
    !validTimes.has(endTime)
  ) {
    redirect(`/book?date=${encodeURIComponent(date)}`);
  }
  if (startTime === endTime) {
    backToForm("range");
  }

  if (!name || !message) {
    backToForm("missing");
  }
  if (email && !EMAIL_PATTERN.test(email)) {
    backToForm("email");
  }
  if (titlePublicAllowed && !title) {
    backToForm("titleRequired");
  }
  if (
    name.length > 100 ||
    email.length > 200 ||
    message.length > MESSAGE_MAX_LENGTH ||
    title.length > TITLE_MAX_LENGTH
  ) {
    backToForm("missing");
  }

  const available = await isRangeAvailable(date, startTime, endTime);
  if (!available) {
    backToForm("taken");
  }

  const booking = await createBookingRequest({
    date,
    startTime,
    endTime,
    name,
    email,
    message,
    title,
    titlePublicAllowed,
  });
  await sendEmailSafely(() => sendBookingRequestEmail(booking));

  toDone();
}

export async function approveBooking(id: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const replyMessage = String(formData.get("replyMessage") ?? "").trim().slice(0, MESSAGE_MAX_LENGTH);
  await setBookingStatus(id, "approved");
  const booking = await getBooking(id);
  if (booking?.email) {
    await sendEmailSafely(() => sendBookingDecisionEmail(booking, "approved", replyMessage));
  }
  revalidatePath("/admin");
}

export async function rejectBooking(id: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const replyMessage = String(formData.get("replyMessage") ?? "").trim().slice(0, MESSAGE_MAX_LENGTH);
  await setBookingStatus(id, "rejected");
  const booking = await getBooking(id);
  if (booking?.email) {
    await sendEmailSafely(() => sendBookingDecisionEmail(booking, "rejected", replyMessage));
  }
  revalidatePath("/admin");
}

export async function showBookingTitle(id: string): Promise<void> {
  await requireAdmin();
  // setTitleVisibility itself refuses this when the requester never allowed
  // it — that's enforced at the data layer, not just by hiding the button.
  await setTitleVisibility(id, true);
  revalidatePath("/admin");
}

export async function hideBookingTitle(id: string): Promise<void> {
  await requireAdmin();
  await setTitleVisibility(id, false);
  revalidatePath("/admin");
}

export async function cancelBooking(id: string): Promise<void> {
  await requireAdmin();
  await setBookingStatus(id, "cancelled");
  revalidatePath("/admin");
  revalidatePath("/admin/schedule");
}

export async function adminSignOut(): Promise<void> {
  await signOut({ redirectTo: "/admin/login" });
}

/**
 * Bulk-creates owner schedule blocks (e.g. a part-time job shift) from two
 * combinable sources in one submission: a weekday-recurrence pattern over a
 * date range, and/or individually tapped dates on the calendar grid. Dates
 * that already conflict with an existing booking are skipped, not forced.
 */
export async function createOwnerScheduleBlocks(formData: FormData): Promise<void> {
  await requireAdmin();

  const month = String(formData.get("month") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  const label = String(formData.get("label") ?? "").trim() || "予定あり";
  const rangeStart = String(formData.get("rangeStart") ?? "");
  const rangeEnd = String(formData.get("rangeEnd") ?? "");
  const weekdays = new Set(formData.getAll("weekdays").map(String));
  const pickedDates = formData.getAll("dates").map(String);

  const scheduleUrl = (params: string) => `/admin/schedule?month=${encodeURIComponent(month)}${params}`;

  const validTimes = new Set(generateTimeOptions());
  if (
    !isValidTimeString(startTime) ||
    !isValidTimeString(endTime) ||
    !validTimes.has(startTime) ||
    !validTimes.has(endTime) ||
    startTime === endTime
  ) {
    redirect(scheduleUrl("&error=time"));
  }

  const targetDates = new Set<string>();

  if (weekdays.size > 0 && isValidDateString(rangeStart) && isValidDateString(rangeEnd)) {
    if (rangeEnd >= rangeStart) {
      const span = daysFromToday(rangeEnd) - daysFromToday(rangeStart);
      if (span <= MAX_SCHEDULE_RANGE_DAYS) {
        for (const date of enumerateDates(rangeStart, rangeEnd)) {
          if (weekdays.has(String(getWeekday(date)))) {
            targetDates.add(date);
          }
        }
      }
    }
  }

  for (const date of pickedDates) {
    if (isValidDateString(date)) {
      targetDates.add(date);
    }
  }

  // Only ever block today..OWNER_MAX_DAYS_AHEAD, regardless of source.
  const validDates = [...targetDates].filter((date) => {
    const offset = daysFromToday(date);
    return offset >= 0 && offset <= OWNER_MAX_DAYS_AHEAD;
  });

  if (validDates.length === 0) {
    redirect(scheduleUrl("&error=nodates"));
  }

  let created = 0;
  const skipped: string[] = [];

  for (const date of validDates.sort()) {
    const available = await isRangeAvailable(date, startTime, endTime);
    if (!available) {
      skipped.push(date);
      continue;
    }
    await createOwnerBlock({ date, startTime, endTime, label });
    created += 1;
  }

  revalidatePath("/admin/schedule");

  const skippedParam = skipped.length > 0 ? `&skipped=${encodeURIComponent(skipped.join(","))}` : "";
  redirect(scheduleUrl(`&created=${created}${skippedParam}`));
}
