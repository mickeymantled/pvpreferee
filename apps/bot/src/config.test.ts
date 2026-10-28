import { describe, expect, it } from 'vitest';
import { readConfig } from './config';
import { diagnostic } from './types';

const env = { X_USER_ACCESS_TOKEN: 'SYNTHETIC_NOT_A_CREDENTIAL', BOT_PUBLIC_BASE_URL: 'https://ref.example.org' };
describe('startup configuration', () => {
  it('defaults to dry-run with isolated state and validates published versions', () => {
    expect(readConfig(env)).toMatchObject({ send: false, version: 'v1' });
    expect(readConfig(env).statePath).toMatch(/var\/dry-run.json$/);
    expect(readConfig({ ...env, BOT_SEND: 'true' }).statePath).toMatch(/var\/send.json$/);
    for (const version of ['v0', 'v99999999', 'typo']) expect(() => readConfig({ ...env, BOT_RULEBOOK_VERSION: version })).toThrow('published version');
  });
  it.each(['http://localhost:3000', 'http://127.0.0.1:3000'])('allows %s for dry-run preview only', url => {
    expect(readConfig({ ...env, BOT_PUBLIC_BASE_URL: url }).baseUrl).toBe(url);
    expect(() => readConfig({ ...env, BOT_PUBLIC_BASE_URL: url, BOT_SEND: 'true' })).toThrow();
  });
  it.each(['http://ref.example.org', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://foo.local', 'https://ref.example.org/path', 'https://user:secret@ref.example.org', 'https://ref.example.org?secret=1'])('rejects nonpublic or credential-bearing origins without echoing %s', url => {
    expect(() => readConfig({ ...env, BOT_PUBLIC_BASE_URL: url })).toThrow('BOT_PUBLIC_BASE_URL');
    try { readConfig({ ...env, BOT_PUBLIC_BASE_URL: url }); } catch (error) { expect(diagnostic(error)).not.toContain(url); }
  });
  it('requires credentials and bounds all numerical options', () => {
    expect(() => readConfig({})).toThrow('X_USER_ACCESS_TOKEN');
    for (const values of [{ BOT_PAGE_SIZE: '101' }, { BOT_HTTP_RETRIES: '-1' }, { BOT_POLL_MS: 'NaN' }, { BOT_SEND: 'yes' }]) {
      expect(() => readConfig({ ...env, ...values })).toThrow();
    }
  });
});
