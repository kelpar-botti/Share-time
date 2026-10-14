import { createHash, timingSafeEqual } from 'node:crypto';
import { createSyncService } from './service.mjs';
import { fetchConfirmedMonth, JOBCAN_DIAGNOSTIC_REASONS } from './jobcan.mjs';

const MAX_BODY_BYTES = 4096;
const jobcanReasons = new Set(JOBCAN_DIAGNOSTIC_REASONS);
const jobcanCodes = new Set(['JOBCAN_PARSE', 'JOBCAN_LOGIN', 'JOBCAN_NETWORK', 'JOBCAN_TIMEOUT', 'JOBCAN_CONFIG', 'JOBCAN_IDENTITY', 'JOBCAN_INCOMPLETE']);
function reply(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
function error(code, message, status) { return reply({ ok: false, persisted: false, error: { code, message } }, status); }
function authorized(request, token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) return false;
  const value = request.headers.get('authorization') ?? '';
  if (!value.startsWith('Bearer ') || value.length > 512) return false;
  const digest = text => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(value.slice(7)), digest(token));
}
async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('INVALID_JSON');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_JSON');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

/** A server-owned adapter: callers cannot choose an account, database or Jobcan URL. */
export function createShiftSyncHandler({ getDb, env = () => process.env, fetchMonth = fetchConfirmedMonth, clock } = {}) {
  if (typeof getDb !== 'function') throw new TypeError('getDb is required');
  return async request => {
    if (request.method !== 'POST') return error('METHOD_NOT_ALLOWED', 'POSTで呼び出してください。', 405);
    const settings = env();
    // Disabled until secure settings have been configured and the preview verified.
    if (!authorized(request, settings.SHIFT_SYNC_TOKEN)) return error('UNAUTHORIZED', '連携用の認証が必要です。', 401);
    if (request.headers.has('origin')) return error('SERVICE_ONLY', 'クラウド連携専用の受け口です。', 403);
    const required = ['ADMIN_EMAIL', 'JOBCAN_CLIENT_ID', 'JOBCAN_EMAIL', 'JOBCAN_PASSWORD', 'JOBCAN_STAFF_CODE'];
    if (required.some(key => typeof settings[key] !== 'string' || !settings[key].trim())) {
      return error('CONFIG_REQUIRED', 'ジョブカンのモバイル連携設定が必要です。', 503);
    }
    let body;
    try { body = await readBody(request); }
    catch (failure) { return error(failure.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'INVALID_JSON', '通知の形式が不正です。', 400); }
    if (body?.dryRun !== true && settings.SHIFT_SYNC_ENABLED !== 'true') return error('NOT_ENABLED', 'シフト自動入力はまだ有効になっていません。', 503);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['notification', 'dryRun'].includes(key)) ||
        (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') ||
        !body.notification || typeof body.notification !== 'object' || Array.isArray(body.notification) ||
        Object.keys(body.notification).some(key => !['id','receivedAt','sentAt','subject','month'].includes(key))) {
      return error('INVALID_NOTIFICATION', '確定メールの通知形式が不正です。', 400);
    }
    try {
      const service = createSyncService({
        db: getDb(), ownerEmail: settings.ADMIN_EMAIL,
        fetchMonth: month => fetchMonth(month, {
          clientId: settings.JOBCAN_CLIENT_ID, email: settings.JOBCAN_EMAIL,
          password: settings.JOBCAN_PASSWORD, expectedStaffCode: settings.JOBCAN_STAFF_CODE,
        }),
        ...(clock ? { clock } : {}),
      });
      return reply(await service.sync({ notification: body.notification, dryRun: body.dryRun ?? false }));
    } catch (failure) {
      const code = failure?.code;
      if (code === 'SYNC_BUSY' || code === 'SYNC_LEASE_LOST') return error(code, '同期中です。次回の自動実行で再確認します。', 409);
      if (typeof code === 'string' && code.startsWith('JOBCAN_')) {
        // Log fixed labels only. Never log the exception, message, URL, account or credential.
        console.warn('Share Time Jobcan diagnostic', jobcanCodes.has(code) ? code : 'JOBCAN_UNKNOWN', jobcanReasons.has(failure?.reason) ? failure.reason : 'UNSPECIFIED');
        return error(code, code === 'JOBCAN_LOGIN' ? 'ジョブカンのモバイルログインを確認してください。' : 'ジョブカンの確定シフトを安全に取得できませんでした。予定は変更していません。', 502);
      }
      if (failure instanceof TypeError || failure instanceof RangeError || code === 'INVALID_NOTIFICATION') {
        return error('INVALID_NOTIFICATION', '確定メールの通知を確認できませんでした。', 400);
      }
      // Do not expose provider errors, account identifiers, cookies or credential-bearing URLs.
      console.error('Share Time shift sync failed', typeof code === 'string' && /^[A-Z_]{1,40}$/.test(code) ? code : 'SYNC_FAILED');
      return error('SYNC_FAILED', '同期に失敗しました。次回の自動実行で再確認します。', 500);
    }
  };
}
