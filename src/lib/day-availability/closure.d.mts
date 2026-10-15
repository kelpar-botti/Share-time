import type { Firestore, Transaction, DocumentReference, DocumentData } from 'firebase-admin/firestore';
export type DayAvailability = { date: string; closed: boolean };
export type TimeRange = { date: string; startTime: string; endTime: string };
export type Suggestion = {
  id: string; ownerKey: string; dates: string[]; summary: string; evidence: string;
  source: 'line' | 'discord' | 'manual'; confidence: 'high' | 'medium' | 'low';
  status: 'pending' | 'accepted' | 'dismissed'; createdAt: string; updatedAt: string;
  acceptedDates?: string[]; acceptedAt?: string; existingBookingCount?: number;
};
export class DayClosureError extends Error { code: string; constructor(code: string, message: string); }
export class RangeUnavailableError extends DayClosureError { constructor(reason?: 'closed' | 'taken'); }
export function occupiedDates(range: TimeRange): string[];
export function getDayAvailability(db: Firestore, date: string): Promise<DayAvailability>;
export function getDayAvailabilityRange(db: Firestore, startDate: string, endDate: string): Promise<DayAvailability[]>;
export type VisitorGuard = { ref: DocumentReference; date: string; data?: DocumentData };
export function readVisitorRangeGuard(options: {transaction: Transaction; db: Firestore; range: TimeRange; excludeBookingId?: string}): Promise<VisitorGuard[]>;
export function touchVisitorRangeGuard(transaction: Transaction, guards: VisitorGuard[], now: string): void;
export function createClosureService(options: { db: Firestore; ownerEmail: string; clock?: () => Date | string }): {
  getSuggestion(id: string): Promise<Suggestion>;
  listSuggestions(): Promise<Suggestion[]>;
  createSuggestion(input: {id?: string; dates?: string[]; summary: string; evidence?: string; source: Suggestion['source']; confidence?: Suggestion['confidence']}): Promise<Suggestion>;
  acceptSuggestion(id: string, dates?: string[]): Promise<{ suggestion: Suggestion; changed: boolean; existingBookingCount: number }>;
  dismissSuggestion(id: string): Promise<{ suggestion: Suggestion; changed: boolean }>;
  getDayAvailability(date: string): Promise<DayAvailability>;
  getDayAvailabilityRange(start: string, end: string): Promise<DayAvailability[]>;
};
