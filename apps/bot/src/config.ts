import { resolve } from 'node:path';
import { isIP } from 'node:net';
import { listRulebooks } from '@pvp/config';
import { BotError, isId } from './types';

export interface BotConfig {
  token: string; username: string; baseUrl: string; statePath: string; send: boolean; version: string; sinceId?: string;
  pollMs: number; timeoutMs: number; pipelineTimeoutMs: number; shutdownMs: number;
  maxRetries: number; backoffMs: number; maxBackoffMs: number; requestIntervalMs: number;
  pageSize: number; pagesPerTick: number; jobsPerTick: number; maxJobs: number; jobAttempts: number;
  quotaWindowMs: number; replyQuota: number; authorQuota: number; replyIntervalMs: number;
}
export function readConfig(env: NodeJS.ProcessEnv): BotConfig {
  const fail = (name: string): never => { throw new BotError('CONFIG', `Set a valid ${name}; see apps/bot/README.md.`); };
  const number = (key: string, fallback: number, min = 1, max = 2_000_000_000) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : fail(key);
  };
  const token = env.X_USER_ACCESS_TOKEN?.trim();
  if (!token || /\s/.test(token)) fail('X_USER_ACCESS_TOKEN (OAuth 2.0 user token)');
  const username = env.BOT_USERNAME ?? 'pvpreferee';
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(username)) fail('BOT_USERNAME');
  if (env.BOT_SEND !== undefined && !['true', 'false'].includes(env.BOT_SEND)) fail('BOT_SEND (true or false)');
  const send = env.BOT_SEND === 'true';
  let url: URL;
  try { url = new URL(env.BOT_PUBLIC_BASE_URL ?? ''); } catch { return fail('BOT_PUBLIC_BASE_URL'); }
  const localPreview = !send && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  const publicHost = url.hostname.includes('.') && !isIP(url.hostname.replace(/^\[|\]$/g, '')) &&
    !/\.(localhost|local|internal|test|invalid)$/.test(url.hostname);
  if ((!localPreview && (url.protocol !== 'https:' || !publicHost || !!url.port)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    fail('BOT_PUBLIC_BASE_URL (public HTTPS origin; local HTTP preview only with BOT_SEND=false)');
  }
  if (env.BOT_SINCE_ID !== undefined && !isId(env.BOT_SINCE_ID)) fail('BOT_SINCE_ID');
  const version = env.BOT_RULEBOOK_VERSION ?? 'v1';
  if (!listRulebooks().includes(version)) fail('BOT_RULEBOOK_VERSION (published version)');
  return {
    token: token!, username, baseUrl: url.origin, send, version,
    statePath: resolve(env.BOT_STATE_PATH ?? `./var/${send ? 'send' : 'dry-run'}.json`), sinceId: env.BOT_SINCE_ID,
    pollMs: number('BOT_POLL_MS', 60_000), timeoutMs: number('BOT_HTTP_TIMEOUT_MS', 15_000),
    pipelineTimeoutMs: number('BOT_PIPELINE_TIMEOUT_MS', 120_000), shutdownMs: number('BOT_SHUTDOWN_MS', 30_000),
    maxRetries: number('BOT_HTTP_RETRIES', 3, 0, 10), backoffMs: number('BOT_BACKOFF_MS', 1_000),
    maxBackoffMs: number('BOT_MAX_BACKOFF_MS', 60_000), requestIntervalMs: number('BOT_REQUEST_INTERVAL_MS', 1_000, 0),
    pageSize: number('BOT_PAGE_SIZE', 100, 5, 100), pagesPerTick: number('BOT_PAGES_PER_TICK', 10, 1, 100),
    jobsPerTick: number('BOT_JOBS_PER_TICK', 20, 1, 100), maxJobs: number('BOT_MAX_STORED_MENTIONS', 100_000),
    jobAttempts: number('BOT_JOB_ATTEMPTS', 3, 1, 10), quotaWindowMs: number('BOT_QUOTA_WINDOW_MS', 86_400_000),
    replyQuota: number('BOT_REPLY_QUOTA', 100), authorQuota: number('BOT_AUTHOR_QUOTA', 3),
    replyIntervalMs: number('BOT_REPLY_INTERVAL_MS', 60_000, 0),
  };
}
