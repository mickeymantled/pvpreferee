import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { form } from '../../test/fixtures';
import { hashPassword, SESSION_COOKIE } from '../../server/auth-core';
import { RateLimitError } from '../../server/rate-limit';

const mocks = vi.hoisted(() => ({ protect: vi.fn(), auth: vi.fn(), apply: vi.fn(), rerun: vi.fn(), set: vi.fn(), headers: vi.fn(), redirect: vi.fn(), repository: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.set }), headers: mocks.headers }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('../../server/security', () => ({ protectRequest: mocks.protect, requireAdmin: mocks.auth }));
vi.mock('../../server/overrides', () => ({ applyReviewedOverride: mocks.apply }));
vi.mock('../../server/services', () => ({ withRepository: mocks.repository }));
vi.mock('../../server/rerun', async importOriginal => ({ ...await importOriginal<typeof import('../../server/rerun')>(), rerunStoredRuling: mocks.rerun }));
import { login, logout, rerunAction, saveOverride } from './actions';

beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.auth.mockResolvedValue({ authenticated: true, actor: 'synthetic-brian' });
  mocks.headers.mockResolvedValue(new Headers({ origin: 'https://pvp.example' }));
  mocks.repository.mockImplementation(work => work({ synthetic: true }));
  mocks.redirect.mockImplementation(url => { throw new Error('REDIRECT:' + url); });
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('APP_ORIGIN', 'https://pvp.example');
  vi.stubEnv('ADMIN_EMAIL', 'brian@synthetic.example'); vi.stubEnv('SOURCE_ADMIN_ACTOR', 'synthetic-brian');
  vi.stubEnv('SESSION_SECRET', 'synthetic-secret'.repeat(4));
  vi.stubEnv('ADMIN_PASSWORD_HASH', 'scrypt$' + 'a'.repeat(32) + '$' + 'b'.repeat(128));
});
afterEach(() => vi.unstubAllEnvs());

describe('administrator action wiring', () => {
  it('requires origin/throttle protection before password verification and returns no secrets', async () => {
    mocks.protect.mockRejectedValue(new RateLimitError(429, 900));
    const result = await login({ status: 'idle' }, form({ email: 'x', password: 'secret' }));
    expect(mocks.protect).toHaveBeenCalledWith('login', true);
    expect(result).toMatchObject({ status: 'error', message: expect.stringContaining('900') });
    expect(mocks.set).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('sets a protected cookie on successful fixed-admin login and ignores redirect targets', async () => {
    vi.stubEnv('ADMIN_PASSWORD_HASH', await hashPassword('synthetic-long-password'));
    await expect(login({ status: 'idle' }, form({ email: 'brian@synthetic.example', password: 'synthetic-long-password', next: 'https://evil.example' }))).rejects.toThrow('REDIRECT:/admin/rerun');
    expect(mocks.set).toHaveBeenCalledWith(SESSION_COOKIE, expect.any(String), expect.objectContaining({ secure: true, httpOnly: true, sameSite: 'strict' }));
  });
  it('rejects source writes without an authenticated session', async () => {
    mocks.auth.mockRejectedValue(new Error('Not authenticated'));
    expect(await saveOverride({ status: 'idle' }, form())).toMatchObject({ status: 'error' });
    expect(mocks.protect).toHaveBeenCalledWith('admin', true);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('rejects forged actor fields and forwards only parsed review fields', async () => {
    expect(await saveOverride({ status: 'idle' }, form({ actor: 'attacker' }))).toMatchObject({ status: 'error' });
    expect(mocks.apply).not.toHaveBeenCalled();
    const fields = form({ override_hash: 'f'.repeat(64), canonical_name: 'Cat', canonical_ticker: 'CAT', scope: 'artifact', source_tier: 'subject_post', evidence: 'https://synthetic.example/proof', reason: 'Proof', resolved: 'true' });
    await expect(saveOverride({ status: 'idle' }, fields)).rejects.toThrow('REDIRECT:/resolve?');
    expect(mocks.apply.mock.calls[0]).toHaveLength(3);
    expect(mocks.apply.mock.calls[0]![2]).toMatchObject({ patch: { canonical_name: 'Cat', resolved: true }, reason: 'Proof' });
  });
  it('guards reruns and redirects to the persisted comparison only after save', async () => {
    mocks.rerun.mockResolvedValue({ share_slug: 'new-ruling' });
    await expect(rerunAction({ status: 'idle' }, form({ slug: 'old-ruling', version: 'v1' }))).rejects.toThrow('REDIRECT:/admin/rerun?before=old-ruling&after=new-ruling');
    expect(mocks.protect).toHaveBeenCalledWith('admin', true);
    expect(mocks.auth).toHaveBeenCalledOnce();
    mocks.rerun.mockRejectedValue(new Error('secret db credential'));
    expect(JSON.stringify(await rerunAction({ status: 'idle' }, form({ slug: 'old-ruling' })))).not.toContain('secret');
  });
  it('origin-checks logout before expiring the cookie', async () => {
    mocks.headers.mockResolvedValueOnce(new Headers({ origin: 'https://evil.example' }));
    await expect(logout()).rejects.toThrow('origin');
    expect(mocks.set).not.toHaveBeenCalled();
    await expect(logout()).rejects.toThrow('REDIRECT:/admin/login');
    expect(mocks.set).toHaveBeenCalledWith(SESSION_COOKIE, '', expect.objectContaining({ maxAge: 0, secure: true }));
  });
});
