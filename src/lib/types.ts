export type BookingStatus = "pending" | "approved" | "rejected" | "cancelled";

// "visitor": submitted through the public form, needs admin approval.
// "owner": the admin blocking off their own time (e.g. a part-time job
// shift) directly from the admin schedule page — auto-approved, no visitor.
export type BookingSource = "visitor" | "owner";

export interface Booking {
  id: string;
  date: string; // YYYY-MM-DD (Japan calendar day)
  startTime: string; // HH:mm, inclusive
  endTime: string; // HH:mm, exclusive
  name: string;
  email: string;
  message: string;
  title: string; // 予定名 — short label for the booking, e.g. "歯医者"
  // Set once by the requester at submission time and never changed
  // afterward, by anyone — the one-way consent to ever show the title
  // publicly. When false, titlePublic can never become true.
  titlePublicAllowed: boolean;
  // The title's actual current visibility to other visitors. Only
  // meaningful (and only ever true) when titlePublicAllowed is true — the
  // admin can freely toggle this on/off within that constraint.
  titlePublic: boolean;
  status: BookingStatus;
  source: BookingSource;
  approveToken: string;
  rejectToken: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}
