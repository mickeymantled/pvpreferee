import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, vi } from 'vitest';
import type { Ruling } from '@pvp/shared';
import { readConfig } from './config';
import { parsePost } from './x-api';
import fixtures from './fixtures/x.synthetic.json';
import type { Clock, XApi } from './types';

export { fixtures };
export const ca1 = '11111111111111111111111111111111';
export const ca2 = 'So11111111111111111111111111111111111111112';
export const me = fixtures.me.data;
export const mention = parsePost(fixtures.page1.data[0]);
export const parentMention = parsePost(fixtures.page1.data[1]);
export const parent = parsePost(fixtures.parent.data);
export const noSource = parsePost(fixtures.page2.data[0]);
// Header-only synthetic PNG used with injected renderers, never uploaded to X.
export const png = Buffer.from('89504e470d0a1a0a', 'hex');
export function config() {
  return { ...readConfig({ X_USER_ACCESS_TOKEN: 'SYNTHETIC_NOT_A_CREDENTIAL', BOT_PUBLIC_BASE_URL: 'https://ref.example.org' }),
    send: true, replyIntervalMs: 0, authorQuota: 100, pollMs: 10, backoffMs: 10, requestIntervalMs: 0 };
}
export function fakeClock(): Clock & { value: number; sleeps: number[] } {
  return { value: Date.parse('2026-10-28T12:00:00Z'), sleeps: [], now() { return this.value; },
    async sleep(ms, signal) { signal.throwIfAborted(); this.sleeps.push(ms); this.value += ms; } };
}
const directories: string[] = [];
export async function statePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pvp-bot-test-'));
  directories.push(directory);
  return join(directory, 'state.json');
}
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
export function fakeApi(): XApi {
  return {
    me: vi.fn(async () => me), mentions: vi.fn(async () => ({ data: [] })), post: vi.fn(async () => null),
    upload: vi.fn(async () => '500'), reply: vi.fn(async () => '600'),
  };
}
export const signal = () => new AbortController().signal;
// Structural synthetic ruling for transport/planner tests. No facts are invented as live evidence.
export function ruling(status: Ruling['status'] = 'resolved'): Ruling {
  return { status, winner_ca: status === 'resolved' ? ca1 : null, share_slug: 'synthetic-ruling' } as Ruling;
}
