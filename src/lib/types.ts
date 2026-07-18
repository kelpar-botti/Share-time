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
  status: BookingStatus;
  source: BookingSource;
  approveToken: string;
  rejectToken: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}
