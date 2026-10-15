// A conservative, deterministic suggestion engine. Conversation text is data only:
// this module has no network, storage, calendar or model access.
const MAX_MESSAGES = 80;
const MAX_TEXT_LENGTH = 1500;
const DAY_MS = 86_400_000;
const JST_MS = 9 * 3_600_000;
const SENDERS = new Set(['self', 'other', 'unknown']);

const AGREEMENT = /了解|承知|わかった|わかりました|分かった|分かりました|(?:それ|その日|その時間|その日程|その予定|その日時)で(?:いい|大丈夫|お願い|OK|オッケー|決まり|確定)|(?:^|[^a-z])ok(?:$|[^a-z])|オッケー|おっけー|いいよ|いいね|大丈夫(?:です|だよ|！|!|。|$)|決まり|確定|賛成|(?:一緒に)?行こう|いこう|よろしく/iu;
const UNCERTAIN = /たぶん|多分|かもしれ|かも|できたら|出来たら|行けたら|いけたら|仮(?:で|に|の|決|予)|未定|検討|確認(?:して|する|します)|わから|分から|どうだろ|相談(?:して|する)|まだ(?:決|わか|分か)|予定は未/;
const REJECTION = /(?:行け|いけ|会え|でき|出来|空いて|空い)(?:ない|ません)|無理|難しい|都合が悪|やめ(?:よう|る|ます)|中止|キャンセル|取り消|取消|延期(?:し|で)|(?:了解|確定|決まり|大丈夫|いい)(?:では|じゃ)(?:ない|ありません)|(?:それ|その日|その時間)は(?:だめ|ダメ)|嫌|拒否/;
const EVENT = /遊|会お|会う|会い|飲も|飲み|ご飯|食事|ランチ|ディナー|映画|カラオケ|行こ|行く|行き|集合|約束|予定|予約|打ち合わせ|ミーティング|相談|訪問|デート|キャンプ|旅行|ライブ|イベント|空いて|暇|都合|どう[?？]|どうかな|にしよう|にする|でいい|でどう|でOK|でお願い|変更|ずら|延期/iu;
const CORRECTION = /やっぱり|やはり|変更|訂正|ずら|(?:じゃなく|ではなく)|代わり|にしよう|にする/;
const MULTI_DAY = /泊|翌日|朝まで|日付(?:を|が).*(?:また|跨)|(?:また|跨)ぐ|から.*(?:まで|にかけて)/;

function dayNumber(iso) { return Date.parse(`${iso}T00:00:00Z`) / DAY_MS; }
function formatDate(year, month, day) {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function localDay(timestamp) { return new Date(timestamp + JST_MS).toISOString().slice(0, 10); }
function addDays(date, days) { return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10); }
function clarification(reason, evidenceMessageIds = []) {
  return { status: 'needs_clarification', clarification: { reason, evidenceMessageIds: [...new Set(evidenceMessageIds)] } };
}
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function datesIn(text, sentAt) {
  // Do not treat URL path components as proposed dates.
  const value = text.normalize('NFKC').replace(/https?:\/\/\S+/gu, ' ');
  const base = localDay(sentAt);
  const [baseYear, baseMonth, baseDay] = base.split('-').map(Number);
  const tokens = [];
  const occupied = [];
  let invalid = false;
  let unsupported = false;
  const add = (match, date) => {
    if (occupied.some(([start, end]) => match.index < end && match.index + match[0].length > start)) return;
    occupied.push([match.index, match.index + match[0].length]);
    if (date) tokens.push(date); else invalid = true;
  };
  const monthDay = (year, month, day) => {
    // Without a year, only the ordinary December -> January rollover is inferred.
    // A past day in this month is not silently moved a year into the future.
    const inferredYear = year ?? (baseMonth - month >= 6 ? baseYear + 1 : baseYear);
    return formatDate(inferredYear, month, day);
  };
  for (const match of value.matchAll(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/gu)) {
    add(match, monthDay(match[1] ? Number(match[1]) : undefined, Number(match[2]), Number(match[3])));
  }
  for (const match of value.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/gu)) add(match, formatDate(Number(match[1]), Number(match[2]), Number(match[3])));
  for (const match of value.matchAll(/(?<![\d/])(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})(?![\d/])/gu)) {
    add(match, monthDay(match[1] ? Number(match[1]) : undefined, Number(match[2]), Number(match[3])));
  }
  for (const match of value.matchAll(/(?<!\d)(\d{1,2})日(?!間)/gu)) {
    const day = Number(match[1]);
    let year = baseYear;
    let month = baseMonth;
    if (day < baseDay) { month += 1; if (month === 13) { month = 1; year += 1; } }
    add(match, formatDate(year, month, day));
  }
  const offsets = { 今日: 0, 明日: 1, あした: 1, 明後日: 2, あさって: 2, 明々後日: 3, しあさって: 3 };
  for (const match of value.matchAll(/明々後日|しあさって|明後日|あさって|明日|あした|今日/gu)) add(match, addDays(base, offsets[match[0]]));
  const weekdays = '月火水木金土日';
  for (const match of value.matchAll(/(再来週|来週|今週)(?:の)?([月火水木金土日])曜(?:日)?/gu)) {
    const mondayOffset = (new Date(`${base}T00:00:00Z`).getUTCDay() + 6) % 7;
    const weeks = { 今週: 0, 来週: 1, 再来週: 2 }[match[1]];
    add(match, addDays(base, -mondayOffset + weeks * 7 + weekdays.indexOf(match[2])));
  }
  // A bare weekday / 今度 / numeric date without 日 can be interpreted several ways.
  for (const match of value.matchAll(/(?:次の|今度の)?[月火水木金土日]曜(?:日)?|来週|再来週|今度|来月|月末|週末/gu)) {
    if (!occupied.some(([start, end]) => match.index >= start && match.index < end)) unsupported = true;
  }
  return { dates: [...new Set(tokens)], invalid, unsupported };
}

function correctionTail(text) {
  const matches = [...text.matchAll(/じゃなく(?:て)?|ではなく(?:て)?/gu)];
  if (!matches.length) return text;
  const last = matches.at(-1);
  return text.slice(last.index + last[0].length);
}

function timesIn(text) {
  const times = [];
  let invalid = false;
  for (const match of text.matchAll(/(?<!\d)(\d{1,2})(?::(\d{2})|時(?:(\d{1,2})分)?)(?!\d)/gu)) {
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? match[3] ?? 0);
    const prefix = text.slice(Math.max(0, match.index - 2), match.index);
    if (/午[前後]/u.test(prefix)) {
      if (hour > 12) invalid = true;
      else if (prefix === '午前') hour %= 12;
      else hour = hour % 12 + 12;
    }
    if (hour > 23 || minute > 59) invalid = true;
    else times.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
  return { times: [...new Set(times)], invalid, choice: times.length > 1 && /か|または|もしくは|\bor\b/iu.test(text) };
}

/**
 * Analyze one conversation and suggest, never apply, a whole-day closure.
 * Dates use the message's Asia/Tokyo date. `now` is an ISO timestamp; when omitted
 * the newest supplied message is the deterministic reference point. An importer
 * should provide its actual receive time and deduplicate proposals by agreement ID.
 */
export function analyzeConversation({ conversationId, messages, now, maxFutureDays = 365 } = {}) {
  if (typeof conversationId !== 'string' || !conversationId || conversationId.length > 200 || !Array.isArray(messages)
    || messages.length > MAX_MESSAGES || !Number.isInteger(maxFutureDays) || maxFutureDays < 1 || maxFutureDays > 730) return clarification('INVALID_INPUT');
  const seen = new Set();
  const thread = [];
  for (const [index, message] of messages.entries()) {
    if (!message || message.conversationId !== conversationId) continue;
    if (typeof message.id !== 'string' || !message.id || message.id.length > 200 || !SENDERS.has(message.sender)
      || typeof message.text !== 'string' || message.text.length > MAX_TEXT_LENGTH || timestamp(message.sentAt) === null) return clarification('INVALID_MESSAGE');
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    thread.push({ ...message, timestamp: timestamp(message.sentAt), index, text: message.text.normalize('NFKC').trim() });
  }
  thread.sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
  if (!thread.length) return { status: 'none' };
  const reference = now === undefined ? thread.at(-1).timestamp : timestamp(now);
  if (reference === null) return clarification('INVALID_INPUT');
  if (thread.some(message => message.timestamp > reference + 5 * 60_000)) return clarification('FUTURE_MESSAGE');
  const today = localDay(reference);
  let candidate = null;
  let result = { status: 'none' };

  for (const message of thread) {
    const text = message.text;
    const hasAgreement = AGREEMENT.test(text);
    const isCorrection = CORRECTION.test(text);
    const parsed = datesIn(isCorrection ? correctionTail(text) : text, message.timestamp);
    const timeInfo = timesIn(isCorrection ? correctionTail(text) : text);
    const hasDate = parsed.dates.length > 0 || parsed.invalid || parsed.unsupported;
    const isEvent = EVENT.test(text);

    if (REJECTION.test(correctionTail(text))) {
      // A rejection or cancellation invalidates a previously accepted date too.
      if (candidate || hasDate || hasAgreement) { candidate = null; result = { status: 'none' }; }
      continue;
    }
    if (candidate && hasDate && !isEvent && !hasAgreement && !isCorrection) {
      // A later date fact (e.g. 「21日は雨」) must not replace an actual
      // invitation and then turn a casual 「了解」 into a different plan.
      candidate = null;
      result = clarification('INSUFFICIENT_PLAN_CONTEXT', [message.id]);
      continue;
    }
    if (!isEvent && !hasAgreement) continue;
    if (candidate && hasAgreement && /[?？]\s*$/u.test(text)) {
      result = clarification('AGREEMENT_IS_QUESTION', [...candidate.evidenceMessageIds, message.id]);
      continue;
    }
    if (UNCERTAIN.test(text)) {
      if (candidate || hasDate) {
        candidate = null;
        result = clarification('TENTATIVE_PLAN', [message.id]);
      }
      continue;
    }
    if ((hasDate && (parsed.invalid || parsed.unsupported)) || (isEvent && MULTI_DAY.test(text))) {
      candidate = null;
      result = clarification(parsed.invalid ? 'INVALID_DATE' : 'UNSUPPORTED_DATE_CONTEXT', [message.id]);
      continue;
    }
    if (timeInfo.invalid && (candidate || hasDate)) {
      candidate = null;
      result = clarification('UNSUPPORTED_TIME_CONTEXT', [message.id]);
      continue;
    }

    if (hasAgreement && candidate) {
      const evidence = [...candidate.evidenceMessageIds, message.id];
      if (result.status === 'proposal' && !isCorrection
        && (!parsed.dates.length || (parsed.dates.length === 1 && parsed.dates[0] === result.proposal.date))
        && !timeInfo.choice && (!timeInfo.times.length || timeInfo.times.every(time => candidate.times.includes(time)))) {
        // Consecutive 「了解」「よろしく」 do not create multiple proposals for
        // the same effective agreement. The importer keys on the original ID.
        continue;
      }
      if (message.sender === 'unknown' || candidate.sender === 'unknown') {
        result = clarification('MISSING_SENDER_CONTEXT', evidence);
      } else if (message.sender === candidate.sender) {
        result = clarification('SINGLE_SIDED_CONTEXT', evidence);
      } else {
        const selected = parsed.dates.length ? parsed.dates : candidate.dates;
        if (selected.length !== 1) result = clarification('MULTIPLE_DATES', evidence);
        else if (!candidate.dates.includes(selected[0])) {
          result = clarification('DATE_CHANGED_WITH_AGREEMENT', evidence);
          candidate = { dates: selected, times: timeInfo.times, timeChoice: timeInfo.choice, sender: message.sender, evidenceMessageIds: evidence };
        }
        else if (timeInfo.choice || (candidate.timeChoice && timeInfo.times.length !== 1)) result = clarification('MULTIPLE_TIMES', evidence);
        else if (timeInfo.times.length && candidate.times.length && timeInfo.times.some(time => !candidate.times.includes(time))) {
          result = clarification('TIME_CHANGED_WITH_AGREEMENT', evidence);
          candidate = { ...candidate, times: timeInfo.times, timeChoice: timeInfo.choice, sender: message.sender, evidenceMessageIds: evidence };
        }
        else if (dayNumber(selected[0]) < dayNumber(today) || dayNumber(selected[0]) > dayNumber(today) + maxFutureDays) result = clarification('DATE_OUTSIDE_WINDOW', evidence);
        else {
          const date = selected[0];
          result = { status: 'proposal', proposal: {
            date, scope: 'all_day', evidenceMessageIds: [...new Set(evidence)],
            agreementMessageId: message.id, agreedBy: message.sender,
            summary: `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日の予定への同意を検知しました。この日は終日受付停止を提案します。`,
            reason: 'AGREEMENT_WITH_DATE_CONTEXT', needsConfirmation: true,
          } };
        }
      }
      // Retain the date context so an explicit correction can invalidate the result,
      // but duplicate acknowledgement does not become a new opposite-side offer.
      continue;
    }

    if (hasAgreement && !candidate && hasDate) {
      candidate = { dates: parsed.dates, times: timeInfo.times, timeChoice: timeInfo.choice, sender: message.sender, evidenceMessageIds: [message.id] };
      result = clarification('MISSING_CONVERSATION_CONTEXT', [message.id]);
    } else if (hasDate && isEvent) {
      candidate = { dates: parsed.dates, times: timeInfo.times, timeChoice: timeInfo.choice, sender: message.sender, evidenceMessageIds: [message.id] };
      result = parsed.dates.length > 1 ? clarification('MULTIPLE_DATES', [message.id]) : { status: 'none' };
    } else if (candidate && (isCorrection || (timeInfo.times.length && isEvent))) {
      // Time-only corrections also require a fresh acknowledgement.
      candidate = { ...candidate, times: timeInfo.times.length ? timeInfo.times : candidate.times, timeChoice: timeInfo.choice, sender: message.sender, evidenceMessageIds: [...candidate.evidenceMessageIds, message.id] };
      result = { status: 'none' };
    }
  }
  return result;
}
