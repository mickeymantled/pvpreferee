import { createHmac, timingSafeEqual } from 'node:crypto';

export const limits = {
  comparison: { count: 12, seconds: 60 }, source: { count: 30, seconds: 60 },
  card: { count: 30, seconds: 60 }, login: { count: 5, seconds: 900 },
  admin: { count: 15, seconds: 60 },
} as const;
export type LimitScope = keyof typeof limits;
export class RateLimitError extends Error {
  constructor(public readonly status: 429 | 503, public readonly retryAfter: number) {
    super(status === 429 ? `Too many requests. Try again in ${retryAfter} seconds.` : 'Request protection is unavailable. Please try again later.');
  }
}
export interface Counter { increment(key: string, seconds: number): Promise<{ count: number; ttl: number }> }
export class MemoryCounter implements Counter {
  private buckets = new Map<string, { count: number; end: number }>();
  constructor(private now = Date.now) {}
  async increment(key: string, seconds: number) {
    const now = this.now();
    // Bounded local state; only for development, never distributed protection.
    for (const [id, value] of this.buckets) if (value.end <= now) this.buckets.delete(id);
    let entry = this.buckets.get(key);
    if (!entry) {
      if (this.buckets.size >= 10000) throw new Error('Counter capacity');
      entry = { count: 0, end: now + seconds * 1000 }; this.buckets.set(key, entry);
    }
    return { count: ++entry.count, ttl: Math.max(1, Math.ceil((entry.end - now) / 1000)) };
  }
}
// INCR and expiry are one Redis script, not a non-atomic HTTP pipeline.
export const COUNTER_SCRIPT = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('TTL',KEYS[1])}";
export class RedisRestCounter implements Counter {
  constructor(private url: string, private token: string, private request: typeof fetch = fetch) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Invalid rate-limit backend URL');
  }
  async increment(key: string, seconds: number) {
    const response = await this.request(this.url, { method: 'POST', headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' }, body: JSON.stringify(['EVAL', COUNTER_SCRIPT, '1', key, String(seconds)]), signal: AbortSignal.timeout(3000), cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error('Rate-limit backend unavailable');
    const body = await response.json() as { result?: unknown; error?: unknown };
    if (body.error || !Array.isArray(body.result) || body.result.length !== 2) throw new Error('Invalid counter response');
    const [count, ttl] = body.result as unknown[];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || typeof ttl !== 'number' || !Number.isSafeInteger(ttl) || ttl < 0 || ttl > seconds) throw new Error('Invalid counter values');
    return { count, ttl: Math.max(1, ttl) };
  }
}
/** Optional edge-signed identity. Arbitrary forwarding/IP headers are ignored.
 * The trusted edge must strip incoming x-pvp-* headers and sign the verified key.
 */
export function verifiedClientKey(headers: Pick<Headers, 'get'>, env: NodeJS.ProcessEnv, now = Date.now()): string {
  const secret = env.RATE_LIMIT_CLIENT_SECRET;
  const key = headers.get('x-pvp-client'), at = headers.get('x-pvp-client-at'), sig = headers.get('x-pvp-client-signature');
  if (!secret || secret.length < 32 || !key || !/^[a-zA-Z0-9:._-]{1,128}$/.test(key) || !at || !/^\d{10}$/.test(at) || Math.abs(now / 1000 - Number(at)) > 60 || !sig || !/^[a-f0-9]{64}$/.test(sig)) return 'global';
  const expected = createHmac('sha256', secret).update(`${at}\n${key}`).digest();
  if (!timingSafeEqual(Buffer.from(sig, 'hex'), expected)) return 'global';
  return createHmac('sha256', secret).update(key).digest('hex');
}
const memory = new MemoryCounter();
export async function enforceRateLimit(scope: LimitScope, headers: Pick<Headers, 'get'>, env: NodeJS.ProcessEnv = process.env, injected?: Counter): Promise<void> {
  const limit = limits[scope];
  try {
    const counter = injected ?? (env.RATE_LIMIT_REDIS_REST_URL && env.RATE_LIMIT_REDIS_REST_TOKEN
      ? new RedisRestCounter(env.RATE_LIMIT_REDIS_REST_URL, env.RATE_LIMIT_REDIS_REST_TOKEN)
      : env.NODE_ENV === 'development' || env.NODE_ENV === 'test' ? memory : null);
    if (!counter) throw new Error('Shared rate limiter required');
    // All login attempts share one bucket, even if the edge provides identities.
    const key = scope === 'login' ? 'global' : verifiedClientKey(headers, env);
    const result = await counter.increment(`pvp:limit:${scope}:${key}`, limit.seconds);
    if (result.count > limit.count) throw new RateLimitError(429, result.ttl);
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    throw new RateLimitError(503, 60);
  }
}
