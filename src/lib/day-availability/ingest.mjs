import { createHash } from 'node:crypto';
import { analyzeConversation } from './conversation.mjs';
import { DayClosureError } from './closure.mjs';

export const CLARIFICATIONS = {
  MISSING_SENDER_CONTEXT: '発言者を確認できません。候補の日付と、予定が決まったかを確認してください。',
  SINGLE_SIDED_CONTEXT: '片方の発言しか確認できません。双方の合意と日付を確認してください。',
  MULTIPLE_DATES: '候補の日付が複数あります。決まった日を選んでください。',
  MULTIPLE_TIMES: '候補の時間が複数あります。予定が決まったか確認してください。',
  DATE_CHANGED_WITH_AGREEMENT: '同意と同時に日付が変わっています。最終の日付を確認してください。',
  TIME_CHANGED_WITH_AGREEMENT: '同意と同時に時間が変わっています。予定が決まったか確認してください。',
  AGREEMENT_IS_QUESTION: '同意ではなく質問の可能性があります。予定が決まったか確認してください。',
  TENTATIVE_PLAN: '仮の予定や確認待ちの可能性があります。',
  MISSING_CONVERSATION_CONTEXT: '直前の会話が足りません。会話を追加するか日付を選んでください。',
  INSUFFICIENT_PLAN_CONTEXT: '予定の提案かどうか判断できません。会話と日付を確認してください。',
  UNSUPPORTED_DATE_CONTEXT: '曖昧な日付や日をまたぐ予定です。受付停止する日を選んでください。',
  UNSUPPORTED_TIME_CONTEXT: '時間を特定できません。内容を確認してください。',
  INVALID_DATE: '日付を読み取れませんでした。正しい日付を選んでください。',
  DATE_OUTSIDE_WINDOW: '日付が受付可能な期間外です。日付を確認してください。',
};

export function validateConversation(input, now = new Date().toISOString()) {
  const fail = () => { throw new DayClosureError('invalid_conversation', '会話の形式を確認してください。1会話80件、各1500文字までです。'); };
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['source', 'conversationId', 'messages'].includes(key)) || !['line', 'discord'].includes(input.source)) fail();
  if (typeof input.conversationId !== 'string' || !input.conversationId.trim() || input.conversationId.length > 200 || !Array.isArray(input.messages) || !input.messages.length || input.messages.length > 80) fail();
  const seen = new Map();
  for (const message of input.messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || Object.keys(message).some(key => !['id', 'conversationId', 'sender', 'text', 'sentAt'].includes(key)) || message.conversationId !== input.conversationId || typeof message.id !== 'string' || !message.id || message.id.length > 200 || !['self', 'other', 'unknown'].includes(message.sender) || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 1500 || typeof message.sentAt !== 'string' || message.sentAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(message.sentAt) || !Number.isFinite(Date.parse(message.sentAt)) || Date.parse(message.sentAt) > Date.parse(now) + 300000) fail();
    const existing = seen.get(message.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(message)) fail();
    seen.set(message.id, message);
  }
  return { source: input.source, conversationId: input.conversationId, messages: [...seen.values()].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt)) };
}

/** Store only the evidence excerpt of a proposal, never the whole captured notification history. */
export async function ingestConversation({ service, input, now = new Date().toISOString(), allowHistoricalAgreement = false }) {
  const conversation = validateConversation(input, now);
  const analysis = analyzeConversation({ ...conversation, now, maxFutureDays: 365 });
  // Raw contact/thread identifiers never reach storage. A durable, owner-scoped
  // tombstone prevents delayed notification history from reviving an old offer.
  const conversationKey = createHash('sha256').update(JSON.stringify([conversation.source, conversation.conversationId])).digest('hex');
  if (analysis.invalidation) await service.supersedePendingConversation(conversationKey, analysis.invalidation.sentAt);
  if (analysis.status === 'none') return { analysis };
  const proposal = analysis.proposal;
  const last = conversation.messages.at(-1);
  if (proposal && !allowHistoricalAgreement && proposal.agreementMessageId !== last.id) return { analysis: { status: 'none' } };
  if (!proposal && !CLARIFICATIONS[analysis.clarification.reason]) return { analysis };
  const evidenceIds = proposal?.evidenceMessageIds ?? analysis.clarification.evidenceMessageIds;
  if (!proposal && !allowHistoricalAgreement && !evidenceIds.includes(last.id)) return { analysis: { status: 'none' } };
  const evidenceMessages = conversation.messages.filter(message => evidenceIds.includes(message.id));
  const triggerId = proposal?.agreementMessageId ?? last.id;
  const id = `conversation_${createHash('sha256').update(JSON.stringify([conversation.source, conversation.conversationId, triggerId])).digest('hex')}`;
  const evidence = evidenceMessages.map(message => `${message.sentAt} ${message.sender === 'self' ? '自分' : message.sender === 'other' ? '相手' : '発言者不明'}: ${message.text}`).join('\n').slice(-2000);
  const suggestion = await service.createSuggestion({
    id, dates: proposal ? [proposal.date] : analysis.clarification.tentativeDates ?? [], source: conversation.source,
    summary: proposal?.summary ?? CLARIFICATIONS[analysis.clarification.reason],
    evidence, confidence: proposal ? 'high' : 'low',
    conversationKey, contextTimestamp: evidenceMessages.at(-1)?.sentAt ?? last.sentAt,
  });
  // Return analysis, but never raw full messages. A dismissed stable ID stays dismissed.
  return { analysis, suggestion };
}
