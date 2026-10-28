import type { RulingInput } from '@pvp/pipeline';
import type { Ruling } from '@pvp/shared';

export interface Post {
  id: string; text: string; author_id?: string;
  entities?: { mentions?: { username: string; id?: string }[]; urls?: { expanded_url?: string; unwound_url?: string }[] };
  referenced_tweets?: { id: string; type: 'replied_to' | 'quoted' | 'retweeted' }[];
}
export interface Identity { id: string; username: string }
export interface Page { data: Post[]; nextToken?: string }
export interface Scan { sinceId?: string; untilId: string; nextToken?: string; highId?: string; tokens: string[] }
export interface XApi {
  me(signal: AbortSignal): Promise<Identity>;
  mentions(scan: Scan, signal: AbortSignal): Promise<Page>;
  post(id: string, signal: AbortSignal): Promise<Post | null>;
  upload(png: Buffer, signal: AbortSignal): Promise<string>;
  reply(id: string, text: string, mediaId: string | undefined, signal: AbortSignal): Promise<string>;
}
export interface BotRuntime { pipeline: { run(input: RulingInput): Promise<Ruling> }; close(): Promise<void> }
export interface PreparedReply { text: string; kind: 'resolved' | 'unresolved' | 'separate_memes' | 'no_winner' | 'needs_resolution'; png?: string }
export type JobStatus = 'queued' | 'pending' | 'submitted' | 'sent' | 'skipped' | 'failed' | 'dry_run';
export interface Job {
  post: Post; status: JobStatus; attempts: number; nextAttemptAt: number;
  prepared?: PreparedReply; replyId?: string; code?: string;
}
export interface State {
  version: 1; mode: 'send' | 'dry_run'; accountId: string; sinceId?: string; scan?: Scan;
  jobs: Record<string, Job>; attempts: { at: number; authorId: string }[]; blockedUntil: number;
}
export interface Clock { now(): number; sleep(ms: number, signal: AbortSignal): Promise<void> }
export const clock: Clock = {
  now: Date.now,
  async sleep(ms, signal) {
    const until = Date.now() + ms;
    do {
      await new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const stop = () => { clearTimeout(timer); reject(new Error('Stopped')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, Math.max(0, Math.min(60_000, until - Date.now())));
        signal.addEventListener('abort', stop, { once: true });
      });
    } while (Date.now() < until);
  },
};
/** Only these controlled messages may be logged; never log provider errors or bodies. */
export class BotError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryAt = 0) { super(message); }
}
export class RejectedPostError extends BotError {}
export class AmbiguousPostError extends BotError {
  constructor() { super('POST_AMBIGUOUS', 'Reply outcome unknown. Inspect submitted outbox entries before any manual retry.'); }
}
export function diagnostic(error: unknown): string {
  return error instanceof BotError ? `${error.code}: ${error.message}` : 'WORKER_FAILED: Inspect configuration/provider availability; raw errors are intentionally suppressed.';
}
export const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9]{1,19}$/.test(value);
