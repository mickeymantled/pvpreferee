import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AccessError, adminConfig, appOrigin, assertSameOrigin, checkCredentials, cookieOptions, hashPassword, issueSession, SESSION_SECONDS, validateSession } from './auth-core';
import { enforceRateLimit, limits, MemoryCounter, RedisRestCounter, verifiedClientKey } from './rate-limit';

// Synthetic credentials and provider responses only. No environment secrets or network.
const env = { NODE_ENV: 'production' as const, ADMIN_EMAIL: 'brian@synthetic.example', SOURCE_ADMIN_ACTOR: 'synthetic-brian', SESSION_SECRET: 's'.repeat(40), APP_ORIGIN: 'https://pvp.example', ADMIN_PASSWORD_HASH: 'scrypt$' + 'a'.repeat(32) + '$' + 'b'.repeat(128) };
describe('single-administrator authentication', () => {
  it('checks salted password hashes and exact configured identity', async () => {
    const password = 'synthetic password with spaces ';
    const passwordHash = await hashPassword(password);
    const config = adminConfig({ ...env, ADMIN_PASSWORD_HASH: passwordHash });
    expect(await checkCredentials(env.ADMIN_EMAIL, password, config)).toBe(true);
    expect(await checkCredentials('other@synthetic.example', password, config)).toBe(false);
    expect(await checkCredentials(env.ADMIN_EMAIL, password.trim(), config)).toBe(false);
    expect(await checkCredentials(env.ADMIN_EMAIL, 'x'.repeat(1025), config)).toBe(false);
    expect(await hashPassword(password)).not.toBe(passwordHash);
  });
  it.each(['ADMIN_EMAIL', 'SOURCE_ADMIN_ACTOR', 'SESSION_SECRET', 'ADMIN_PASSWORD_HASH', 'APP_ORIGIN'])('fails closed without %s', key => {
    expect(() => adminConfig({ ...env, [key]: '', ADMIN_PASSWORD: 'plaintext-is-ignored' })).toThrow(AccessError);
  });
  it('rejects bad origins and allows localhost only in development', () => {
    for (const APP_ORIGIN of ['https://user:secret@pvp.example', 'https://pvp.example/path', 'http://pvp.example', 'https://pvp.example/']) expect(() => appOrigin({ ...env, APP_ORIGIN })).toThrow();
    expect(appOrigin({ NODE_ENV: 'development' })).toBe('http://localhost:3000');
  });
  it('verifies MAC, expiry, actor and credential rotation without returning secrets', () => {
    const config = adminConfig(env), now = 1800000000000;
    const token = issueSession(config, now);
    expect(validateSession(token, config, now)).toEqual({ authenticated: true, actor: env.SOURCE_ADMIN_ACTOR });
    expect(token).not.toContain(config.secret);
    expect(token).not.toContain(config.passwordHash);
    expect(validateSession(token + 'x', config, now)).toBeNull();
    expect(validateSession(token, config, now - 1000)).toBeNull();
    expect(validateSession(token, config, now + SESSION_SECONDS * 1000)).toBeNull();
    expect(validateSession('garbage', config, now)).toBeNull();
    for (const changed of [{ secret: 'different' }, { actor: 'other' }, { passwordHash: 'rotated' }, { email: 'other' }]) expect(validateSession(token, { ...config, ...changed }, now)).toBeNull();
    expect(cookieOptions).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
    expect(cookieOptions).not.toHaveProperty('domain');
  });
  it('rejects cross-origin and missing-origin mutations, including forwarded host spoofing', () => {
    for (const h of [new Headers(), new Headers({ origin: 'https://evil.example', host: 'pvp.example' }), new Headers({ 'x-forwarded-host': 'pvp.example' }), new Headers({ origin: env.APP_ORIGIN, 'sec-fetch-site': 'cross-site' })]) expect(() => assertSameOrigin(h, env.APP_ORIGIN)).toThrow();
    expect(() => assertSameOrigin(new Headers({ origin: env.APP_ORIGIN }), env.APP_ORIGIN)).not.toThrow();
  });
});
describe('request budgets', () => {
  it('uses an expiring atomic local counter with isolated scopes', async () => {
    let now = 1000;
    const counter = new MemoryCounter(() => now);
    const headers = new Headers();
    for (let i = 0; i < limits.login.count; i++) await enforceRateLimit('login', headers, env, counter);
    await expect(enforceRateLimit('login', headers, env, counter)).rejects.toMatchObject({ status: 429, retryAfter: 900 });
    await expect(enforceRateLimit('card', headers, env, counter)).resolves.toBeUndefined();
    now += 900000;
    await expect(enforceRateLimit('login', headers, env, counter)).resolves.toBeUndefined();
  });
  it('fails closed in production without a shared backend and on backend failure', async () => {
    await expect(enforceRateLimit('source', new Headers(), env)).rejects.toMatchObject({ status: 503 });
    await expect(enforceRateLimit('source', new Headers(), env, { increment: async () => { throw new Error('secret connection detail'); } })).rejects.toMatchObject({ status: 503, message: 'Request protection is unavailable. Please try again later.' });
  });
  it('ignores spoofed IPs and accepts only fresh edge signatures', () => {
    expect(verifiedClientKey(new Headers({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.4' }), env)).toBe('global');
    const secret = 'edge-secret'.repeat(4), now = 1800000000000, at = String(now / 1000), key = 'synthetic-client';
    const headers = new Headers({ 'x-pvp-client': key, 'x-pvp-client-at': at, 'x-pvp-client-signature': createHmac('sha256', secret).update(`${at}\n${key}`).digest('hex') });
    const signedEnv = { ...env, RATE_LIMIT_CLIENT_SECRET: secret };
    expect(verifiedClientKey(headers, signedEnv, now)).not.toBe('global');
    expect(verifiedClientKey(headers, signedEnv, now + 61000)).toBe('global');
    headers.set('x-pvp-client', 'tampered');
    expect(verifiedClientKey(headers, signedEnv, now)).toBe('global');
  });
  it('sends one atomic Redis EVAL with bounded TTL and timeout', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ result: [2, 59] })));
    const counter = new RedisRestCounter('https://redis.example', 'synthetic-token', request);
    expect(await counter.increment('synthetic-key', 60)).toEqual({ count: 2, ttl: 59 });
    const call = request.mock.calls[0]!;
    expect(JSON.parse(call[1]!.body as string)).toEqual(['EVAL', expect.stringContaining("redis.call('EXPIRE'"), '1', 'synthetic-key', '60']);
    expect(call[1]).toMatchObject({ cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) });
  });
  it.each([{ result: [1, -1] }, { result: [1, 9999] }, { result: ['2', 59] }, { error: 'secret' }, { result: null }])('rejects malformed Redis response %j', async body => {
    const counter = new RedisRestCounter('https://redis.example', 'synthetic', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(counter.increment('k', 60)).rejects.toThrow();
  });
});
