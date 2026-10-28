import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
const SCRYPT_OPTIONS = { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) => error ? reject(error) : resolve(key)));
}
export const SESSION_COOKIE = '__Host-pvp-admin';
export const SESSION_SECONDS = 8 * 60 * 60;
export const cookieOptions = { httpOnly: true, secure: true, sameSite: 'strict' as const, path: '/', maxAge: SESSION_SECONDS };
export class AccessError extends Error {}
export interface AdminConfig { email: string; actor: string; passwordHash: string; secret: string; origin: string }

export function appOrigin(env: NodeJS.ProcessEnv): string {
  const value = env.APP_ORIGIN || (env.NODE_ENV === 'development' ? 'http://localhost:3000' : '');
  try {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password ||
        (url.protocol !== 'https:' && !(env.NODE_ENV === 'development' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error();
    return url.origin;
  } catch { throw new AccessError('Server origin is not configured.'); }
}
export function adminConfig(env: NodeJS.ProcessEnv): AdminConfig {
  if (!env.ADMIN_EMAIL?.trim() || !env.SOURCE_ADMIN_ACTOR?.trim() ||
      !env.SESSION_SECRET || Buffer.byteLength(env.SESSION_SECRET) < 32 ||
      !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(env.ADMIN_PASSWORD_HASH ?? '')) {
    throw new AccessError('Administrator sign-in is unavailable.');
  }
  return { email: env.ADMIN_EMAIL, actor: env.SOURCE_ADMIN_ACTOR, passwordHash: env.ADMIN_PASSWORD_HASH!, secret: env.SESSION_SECRET, origin: appOrigin(env) };
}
function equal(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 16 || Buffer.byteLength(password) > 1024) throw new AccessError('Use a password of at least 16 characters and at most 1024 bytes.');
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function checkCredentials(email: string, password: string, config: AdminConfig): Promise<boolean> {
  if (Buffer.byteLength(password) > 1024 || email.length > 254) return false;
  const [, salt, expected] = config.passwordHash.split('$');
  const key = await derive(password, salt!);
  const validPassword = timingSafeEqual(key, Buffer.from(expected!, 'hex'));
  return equal(email, config.email) && validPassword;
}
function signature(payload: string, config: AdminConfig): string {
  // Credential or actor rotation also invalidates all existing sessions.
  return createHmac('sha256', config.secret).update(JSON.stringify([payload, config.actor, config.email, config.passwordHash])).digest('base64url');
}
export function issueSession(config: AdminConfig, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ actor: config.actor, issued: Math.floor(now / 1000), expires: Math.floor(now / 1000) + SESSION_SECONDS, nonce: randomBytes(24).toString('hex') })).toString('base64url');
  return payload + '.' + signature(payload, config);
}
export function validateSession(token: string | undefined, config: AdminConfig, now = Date.now()): { authenticated: true; actor: string } | null {
  if (!token || token.length > 2048) return null;
  const [payload, mac, extra] = token.split('.');
  if (!payload || !mac || extra !== undefined || !equal(mac, signature(payload, config))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const seconds = Math.floor(now / 1000);
    if (p.actor !== config.actor || !Number.isInteger(p.issued) || !Number.isInteger(p.expires) ||
        p.issued > seconds || p.expires <= seconds || p.expires - p.issued !== SESSION_SECONDS || typeof p.nonce !== 'string') return null;
    return { authenticated: true, actor: config.actor };
  } catch { return null; }
}
export function assertSameOrigin(headers: Pick<Headers, 'get'>, origin: string): void {
  // No Host/X-Forwarded-Host trust. Missing Origin is deliberately rejected.
  if (headers.get('origin') !== origin || headers.get('sec-fetch-site') === 'cross-site') throw new AccessError('Request origin could not be verified. Reload this page and submit from this site.');
}
