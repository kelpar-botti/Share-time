import { createHash, randomBytes } from 'node:crypto';

const COLLECTION = 'calendarDevices';
const hash = text => createHash('sha256').update(text).digest('hex');
export function calendarOwnerKey(email) { return hash(email.trim().toLowerCase()); }
export class DeviceError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function deviceId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new DeviceError('UNAUTHORIZED', '端末の連携を確認してください。');
  return id;
}
function publicDevice(id, data) {
  return { id, name: data.name, createdAt: data.createdAt, expiresAt: data.expiresAt, revoked: data.revoked === true };
}

/** Tokens are issued only by an authenticated owner action, never from an incoming device request. */
export function createDeviceService({ db, ownerEmail, clock = () => new Date() }) {
  if (!ownerEmail?.includes('@')) throw new DeviceError('CONFIG_REQUIRED', '管理者の設定が必要です。');
  const ownerKey = calendarOwnerKey(ownerEmail);
  const now = () => new Date(clock());
  return {
    async issue(name) {
      if (typeof name !== 'string' || !name.trim() || name.length > 60) throw new DeviceError('INVALID_NAME', '端末名を60文字以内で入力してください。');
      const token = `stc_${randomBytes(32).toString('base64url')}`;
      const id = hash(token);
      const created = now();
      const data = { ownerKey, name: name.trim(), createdAt: created.toISOString(), expiresAt: new Date(+created + 90 * 86400000).toISOString(), revoked: false };
      await db.collection(COLLECTION).doc(id).set(data);
      return { token, device: publicDevice(id, data) };
    },
    async list() {
      const snap = await db.collection(COLLECTION).where('ownerKey', '==', ownerKey).get();
      return snap.docs.map(doc => publicDevice(doc.id, doc.data())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async revoke(id) {
      const ref = db.collection(COLLECTION).doc(deviceId(id));
      await db.runTransaction(async tx => {
        const data = (await tx.get(ref)).data();
        if (data?.ownerKey !== ownerKey) throw new DeviceError('UNAUTHORIZED', '端末が見つかりません。');
        tx.update(ref, { revoked: true });
      });
    },
    async authenticate(token) {
      if (typeof token !== 'string' || !/^stc_[A-Za-z0-9_-]{43}$/.test(token)) throw new DeviceError('UNAUTHORIZED', '端末の連携が必要です。');
      const id = hash(token);
      const ref = db.collection(COLLECTION).doc(id);
      await db.runTransaction(async tx => {
        const data = (await tx.get(ref)).data();
        const time = now();
        const expiry = Date.parse(data?.expiresAt);
        if (!data || data.ownerKey !== ownerKey || data.revoked || !Number.isFinite(expiry) || !Number.isFinite(+time) || expiry <= +time) throw new DeviceError('UNAUTHORIZED', '端末の連携が無効または期限切れです。');
        const minute = Math.floor(+time / 60000);
        const count = data.requestMinute === minute ? data.requestCount : 0;
        if (count >= 30) throw new DeviceError('RATE_LIMIT', '少し待ってから再試行してください。');
        tx.update(ref, { requestMinute: minute, requestCount: count + 1 });
      });
      return { id };
    },
  };
}
