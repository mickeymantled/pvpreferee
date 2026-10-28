import { InvalidInputError } from '@pvp/pipeline';
import type { BotConfig } from './config';
import { actualMention, extractCas, parentId } from './input';
import type { ReplyPlanner } from './replies';
import type { StateStore } from './state';
import { BotError, RejectedPostError, clock, diagnostic, type Clock, type Identity, type Job, type XApi } from './types';

export type Reporter = (event: string, mentionId?: string) => void;
const terminal = new Set(['sent', 'skipped', 'failed', 'dry_run', 'submitted']);
const fatal = (error: unknown) => error instanceof BotError && /^(STATE_|IDENTITY|X_AUTH|X_ACCESS|RUNTIME_CONFIG|CAPACITY)/.test(error.code);
export class Worker {
  private me?: Identity;
  private busy = false;
  constructor(private readonly config: BotConfig, private readonly api: XApi, private readonly store: StateStore,
    private readonly planner: Pick<ReplyPlanner, 'prepare' | 'close'>, private readonly report: Reporter = () => undefined,
    private readonly time: Clock = clock) {}

  async initialize(signal: AbortSignal): Promise<void> {
    this.me = await this.api.me(signal);
    if (this.me.username.toLowerCase() !== this.config.username.toLowerCase() || this.store.data.accountId && this.store.data.accountId !== this.me.id) {
      throw new BotError('IDENTITY', 'Authenticated X account does not match BOT_USERNAME or the state account.');
    }
    this.store.data.accountId = this.me.id;
    await this.store.save();
    for (const [id, job] of Object.entries(this.store.data.jobs)) {
      if (job.status === 'submitted') this.report('SUBMITTED_NEEDS_RECONCILIATION', id);
    }
  }
  async tick(signal: AbortSignal): Promise<void> {
    if (!this.me || this.busy) throw new BotError('IDENTITY', 'Initialize once and run only one worker tick at a time.');
    this.busy = true;
    try { await this.poll(signal); await this.process(signal); }
    finally { this.busy = false; }
  }
  private async poll(signal: AbortSignal): Promise<void> {
    const state = this.store.data;
    if (!state.scan) {
      // Freeze the upper bound before fetching any page; incoming mentions wait for the next scan.
      const untilId = ((BigInt(this.time.now()) - 1288834974657n) << 22n).toString();
      if (state.sinceId && BigInt(untilId) <= BigInt(state.sinceId)) throw new BotError('CURSOR_CLOCK', 'Clock or initial cursor is ahead of this scan; cursor retained.');
      state.scan = { sinceId: state.sinceId, untilId, tokens: [] };
      await this.store.save();
    }
    for (let page = 0; page < this.config.pagesPerTick && state.scan; page++) {
      signal.throwIfAborted();
      const scan = state.scan;
      let result;
      try { result = await this.api.mentions(scan, signal); }
      catch (error) {
        // An expired pagination token must restart the SAME bounded scan, never advance since_id.
        if (error instanceof BotError && error.code === 'X_REJECTED' && scan.nextToken) {
          delete scan.nextToken; scan.tokens = []; await this.store.save();
        }
        throw error;
      }
      if (result.nextToken && (scan.tokens.includes(result.nextToken) || result.nextToken === scan.nextToken)) throw new BotError('X_PAGINATION', 'X repeated a pagination token; scan retained for inspection.');
      if (result.data.some(post => BigInt(post.id) >= BigInt(scan.untilId) || scan.sinceId && BigInt(post.id) <= BigInt(scan.sinceId))) throw new BotError('X_PAGINATION', 'X returned posts outside the frozen scan; cursor retained.');
      const newPosts = result.data.filter(post => !state.jobs[post.id]);
      if (Object.keys(state.jobs).length + newPosts.length > this.config.maxJobs) throw new BotError('CAPACITY', 'Stored mention limit reached. Archive reviewed terminal entries while stopped, preserving cursor and uncertain submissions.');
      for (const post of result.data) {
        state.jobs[post.id] ??= { post, status: 'queued', attempts: 0, nextAttemptAt: 0 };
        if (!scan.highId || BigInt(post.id) > BigInt(scan.highId)) scan.highId = post.id;
      }
      if (result.nextToken) {
        scan.tokens.push(result.nextToken); scan.nextToken = result.nextToken;
      } else {
        state.sinceId = scan.highId ?? state.sinceId;
        delete state.scan;
      }
      // Persist the inbox and page checkpoint together, before handling any reply.
      await this.store.save();
    }
  }
  private quotaAt(authorId: string): number {
    const state = this.store.data;
    state.attempts = state.attempts.filter(attempt => attempt.at > this.time.now() - this.config.quotaWindowMs);
    const own = state.attempts.filter(attempt => attempt.authorId === authorId);
    return Math.max(state.blockedUntil,
      (state.attempts.at(-1)?.at ?? -Infinity) + this.config.replyIntervalMs,
      state.attempts.length >= this.config.replyQuota ? state.attempts[state.attempts.length - this.config.replyQuota]!.at + this.config.quotaWindowMs : 0,
      own.length >= this.config.authorQuota ? own[own.length - this.config.authorQuota]!.at + this.config.quotaWindowMs : 0);
  }
  private async process(signal: AbortSignal): Promise<void> {
    const jobs = Object.values(this.store.data.jobs).sort((a, b) => BigInt(a.post.id) < BigInt(b.post.id) ? -1 : 1);
    let count = 0;
    for (const job of jobs) {
      signal.throwIfAborted();
      if (terminal.has(job.status) || job.nextAttemptAt > this.time.now()) continue;
      if (++count > this.config.jobsPerTick) break;
      if (!actualMention(job.post, this.me!)) {
        job.status = 'skipped'; job.code = 'NOT_FOREIGN_MENTION'; await this.store.save(); continue;
      }
      if (job.status === 'queued') {
        try {
          const id = parentId(job.post);
          const parent = id ? await this.api.post(id, signal) : null;
          const cas = extractCas([job.post, ...(parent ? [parent] : [])]);
          job.prepared = await this.planner.prepare(job.post, parent, cas, this.me!);
        } catch (error) {
          signal.throwIfAborted();
          if (fatal(error)) throw error;
          if (error instanceof InvalidInputError) { job.status = 'skipped'; job.code = 'INVALID_CAS'; }
          else this.defer(job, error);
          await this.store.save(); continue;
        }
        job.status = 'pending';
        await this.store.save();
      }
      signal.throwIfAborted();
      if (!this.config.send) {
        job.status = 'dry_run'; delete job.prepared!.png;
        await this.store.save(); this.report(`DRY_RUN_${job.prepared!.kind.toUpperCase()}`, job.post.id); continue;
      }
      const quota = this.quotaAt(job.post.author_id!);
      if (quota > this.time.now()) { job.nextAttemptAt = quota; await this.store.save(); continue; }
      let mediaId: string | undefined;
      try { if (job.prepared!.png) mediaId = await this.api.upload(Buffer.from(job.prepared!.png, 'base64'), signal); }
      catch (error) {
        signal.throwIfAborted(); if (fatal(error)) throw error;
        this.defer(job, error); await this.store.save(); continue;
      }
      signal.throwIfAborted();
      if (this.store.data.blockedUntil > this.time.now()) {
        job.nextAttemptAt = this.store.data.blockedUntil; await this.store.save(); continue;
      }
      job.status = 'submitted';
      this.store.data.attempts.push({ at: this.time.now(), authorId: job.post.author_id! });
      await this.store.save(); // durable BEFORE the non-idempotent network call
      let replyId: string;
      try { replyId = await this.api.reply(job.post.id, job.prepared!.text, mediaId, signal); }
      catch (error) {
        if (error instanceof RejectedPostError) {
          job.status = error.code === 'X_RATE_LIMIT' ? 'pending' : 'failed';
          job.nextAttemptAt = error.retryAt; job.code = error.code;
          if (job.status === 'failed') delete job.prepared!.png;
          await this.store.save();
          if (fatal(error)) throw error;
        } else {
          // Includes cancellation, connection loss, 5xx, and malformed success responses.
          job.code = 'POST_AMBIGUOUS'; await this.store.save();
        }
        this.report(job.status === 'submitted' ? 'SUBMITTED_NEEDS_RECONCILIATION' : job.code!, job.post.id);
        continue;
      }
      job.replyId = replyId; job.status = 'sent'; delete job.prepared!.png;
      await this.store.save(); this.report('SENT', job.post.id);
    }
  }
  private defer(job: Job, error: unknown) {
    job.code = error instanceof BotError ? error.code : 'PROVIDER_UNAVAILABLE';
    if (job.code !== 'X_RATE_LIMIT') job.attempts++;
    if (job.attempts >= this.config.jobAttempts || job.code === 'PIPELINE_TIMEOUT') {
      job.status = 'failed'; if (job.prepared) delete job.prepared.png;
    }
    job.nextAttemptAt = Math.max(error instanceof BotError ? error.retryAt : 0,
      this.time.now() + Math.min(this.config.maxBackoffMs, this.config.backoffMs * 2 ** job.attempts));
    this.report(job.status === 'failed' ? `FAILED_${job.code}` : `DEFERRED_${job.code}`, job.post.id);
  }
  async run(signal: AbortSignal): Promise<void> {
    try {
      await this.initialize(signal);
      while (!signal.aborted) {
        try { await this.tick(signal); }
        catch (error) { if (signal.aborted) break; if (fatal(error)) throw error; this.report(diagnostic(error)); }
        await this.time.sleep(Math.max(this.config.pollMs, this.store.data.blockedUntil - this.time.now()), signal);
      }
    } catch (error) { if (!signal.aborted) throw error; }
    finally { try { await this.planner.close(); } finally { await this.store.close(); } }
  }
}
