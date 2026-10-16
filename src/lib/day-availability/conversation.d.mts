export interface ConversationMessage {
  id: string;
  conversationId: string;
  sender: 'self' | 'other' | 'unknown';
  text: string;
  /** An ISO timestamp including Z or an explicit UTC offset. */
  sentAt: string;
}
export interface ConversationProposal {
  date: string;
  scope: 'all_day';
  evidenceMessageIds: string[];
  agreementMessageId: string;
  agreedBy: 'self' | 'other';
  summary: string;
  reason: 'AGREEMENT_WITH_DATE_CONTEXT';
  needsConfirmation: true;
}
export type ConversationInvalidation = {
  sentAt: string;
  evidenceMessageIds: string[];
  reason: 'cancelled' | 'rescheduled';
};
export type ConversationAnalysis = (
  | { status: 'none' }
  | { status: 'proposal'; proposal: ConversationProposal }
  | { status: 'needs_clarification'; clarification: { reason: string; evidenceMessageIds: string[]; tentativeDates?: string[] } }
) & { invalidation?: ConversationInvalidation };
/** Pure conservative analysis; no message, schedule or reservation is modified. */
export function analyzeConversation(input?: {
  conversationId: string;
  messages: ConversationMessage[];
  now?: string;
  maxFutureDays?: number;
}): ConversationAnalysis;
