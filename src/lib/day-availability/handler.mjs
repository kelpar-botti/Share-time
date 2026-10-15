import { createClosureService, DayClosureError } from './closure.mjs';
import { createDeviceService, DeviceError } from './devices.mjs';
import { ingestConversation } from './ingest.mjs';

const MAX_BODY_BYTES = 128 * 1024;
function reply(data, status = 200) { return Response.json(data, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } }); }
function fail(code, message, status) { return reply({ ok: false, error: { code, message } }, status); }
async function readBody(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new DayClosureError('invalid_json', 'JSONで送信してください。');
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new DayClosureError('body_too_large', '会話が長すぎます。');
  const reader = request.body?.getReader();
  if (!reader) throw new DayClosureError('invalid_json', '内容を確認してください。');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new DayClosureError('body_too_large', '会話が長すぎます。'); }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new DayClosureError('invalid_json', '内容を確認してください。'); }
  } finally { reader.releaseLock(); }
}
function privateSuggestion(item) {
  const safe = { ...item };
  delete safe.ownerKey;
  return safe;
}

export function createConversationHandler({ getDb, env = () => process.env, clock = () => new Date() }) {
  return async request => {
    if (!['GET', 'POST', 'PATCH'].includes(request.method)) return fail('METHOD_NOT_ALLOWED', 'この操作は利用できません。', 405);
    if (request.headers.has('origin')) return fail('DEVICE_ONLY', '連携端末専用です。', 403);
    const ownerEmail = env().ADMIN_EMAIL;
    if (!ownerEmail?.includes('@')) return fail('NOT_CONFIGURED', '管理者の設定が必要です。', 503);
    try {
      const db = getDb();
      const devices = createDeviceService({ db, ownerEmail, clock });
      const auth = request.headers.get('authorization') ?? '';
      if (!auth.startsWith('Bearer ') || auth.length > 100) throw new DeviceError('UNAUTHORIZED', '端末の連携が必要です。');
      await devices.authenticate(auth.slice(7));
      const service = createClosureService({ db, ownerEmail, clock });
      if (request.method === 'GET') {
        const suggestions = (await service.listSuggestions()).filter(item => item.status === 'pending').slice(0, 100);
        return reply({ ok: true, suggestions: suggestions.map(privateSuggestion) });
      }
      const body = await readBody(request);
      if (request.method === 'POST') {
        const result = await ingestConversation({ service, input: body, now: new Date(clock()).toISOString() });
        return reply({ ok: true, analysis: result.analysis, ...(result.suggestion ? { suggestion: privateSuggestion(result.suggestion) } : {}) });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['id', 'action', 'dates'].includes(key)) || typeof body.id !== 'string' || !['accept', 'dismiss'].includes(body.action) || (body.action === 'dismiss' && body.dates !== undefined)) throw new DayClosureError('invalid_action', '操作を確認してください。');
      const result = body.action === 'accept' ? await service.acceptSuggestion(body.id, body.dates) : await service.dismissSuggestion(body.id);
      return reply({ ok: true, ...result, suggestion: privateSuggestion(result.suggestion) });
    } catch (error) {
      if (error instanceof DeviceError) return fail(error.code, error.message, error.code === 'RATE_LIMIT' ? 429 : 401);
      if (error instanceof DayClosureError) return fail(error.code, error.message, error.code === 'not_found' ? 404 : error.code === 'already_handled' ? 409 : 400);
      console.error('Share Time conversation request failed');
      return fail('REQUEST_FAILED', '処理に失敗しました。少し待ってから再試行してください。', 500);
    }
  };
}
