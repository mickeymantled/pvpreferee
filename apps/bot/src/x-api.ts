import type { BotConfig } from './config';
import { AmbiguousPostError, BotError, RejectedPostError, clock, isId, type Clock, type Identity, type Page, type Post, type Scan, type XApi } from './types';

export type Transport = (url: string, init: RequestInit) => Promise<Response>;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BotError('X_RESPONSE', 'Unexpected X response schema; no cursor was advanced.');
  return value as Record<string, unknown>;
};
export function parsePost(value: unknown): Post {
  const p = record(value);
  if (!isId(p.id) || typeof p.text !== 'string' || p.text.length > 100_000 || p.author_id !== undefined && !isId(p.author_id)) {
    throw new BotError('X_RESPONSE', 'Invalid X post fields; no cursor was advanced.');
  }
  const result: Post = { id: p.id, text: p.text, author_id: p.author_id as string | undefined };
  if (p.entities !== undefined) {
    const e = record(p.entities);
    result.entities = {};
    if (e.mentions !== undefined) {
      if (!Array.isArray(e.mentions)) throw new BotError('X_RESPONSE', 'Invalid mention entities.');
      result.entities.mentions = e.mentions.map(value => {
        const m = record(value);
        if (typeof m.username !== 'string' || !/^[a-zA-Z0-9_]{1,15}$/.test(m.username) || m.id !== undefined && !isId(m.id)) throw new BotError('X_RESPONSE', 'Invalid mention entity.');
        return { username: m.username, id: m.id as string | undefined };
      });
    }
    if (e.urls !== undefined) {
      if (!Array.isArray(e.urls)) throw new BotError('X_RESPONSE', 'Invalid link entities.');
      result.entities.urls = e.urls.map(value => {
        const link = record(value);
        return { expanded_url: typeof link.expanded_url === 'string' ? link.expanded_url : undefined,
          unwound_url: typeof link.unwound_url === 'string' ? link.unwound_url : undefined };
      });
    }
  }
  const refs = p.referenced_tweets ?? p.referenced_posts;
  if (refs !== undefined) {
    if (!Array.isArray(refs)) throw new BotError('X_RESPONSE', 'Invalid parent references.');
    result.referenced_tweets = refs.map(value => {
      const ref = record(value);
      if (!isId(ref.id) || !['replied_to', 'quoted', 'retweeted'].includes(String(ref.type))) throw new BotError('X_RESPONSE', 'Invalid parent reference.');
      return { id: ref.id, type: ref.type as 'replied_to' | 'quoted' | 'retweeted' };
    });
  }
  return result;
}
export interface RateGate { until(): number; block(until: number): Promise<void> }
export class XClient implements XApi {
  private lastRequestAt = -Infinity;
  constructor(private readonly config: BotConfig, private readonly gate: RateGate,
    private readonly transport: Transport = (url, init) => fetch(url, init), private readonly time: Clock = clock) {}

  private async request(path: string, method: 'GET' | 'POST', body: unknown, signal: AbortSignal, posting = false): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const delay = Math.max(this.gate.until(), this.lastRequestAt + this.config.requestIntervalMs) - this.time.now();
      if (delay > 0) await this.time.sleep(delay, signal);
      signal.throwIfAborted();
      this.lastRequestAt = this.time.now();
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), this.config.timeoutMs);
      let response: Response;
      let payload: unknown;
      let decodeFailed = false;
      try {
        response = await this.transport(`https://api.x.com${path}`, {
          method, redirect: 'error', signal: AbortSignal.any([signal, timeout.signal]),
          headers: { Authorization: `Bearer ${this.config.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        try { payload = await response.json(); } catch { decodeFailed = true; }
      } catch {
        if (posting) throw new AmbiguousPostError();
        signal.throwIfAborted();
        if (attempt >= this.config.maxRetries) throw new BotError('X_NETWORK', 'X request timed out or failed after bounded retries.');
        await this.time.sleep(this.backoff(attempt), signal);
        continue;
      } finally { clearTimeout(timer); }
      const reset = Number(response.headers.get('x-rate-limit-reset')) * 1000;
      if (response.headers.get('x-rate-limit-remaining') === '0' && reset > this.time.now()) await this.gate.block(reset + 1000);
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const retryAt = retry ? (/^\d+$/.test(retry) ? this.time.now() + Number(retry) * 1000 : Date.parse(retry)) : 0;
        const until = Math.max(this.time.now() + this.backoff(attempt), Number.isFinite(reset) ? reset + 1000 : 0, Number.isFinite(retryAt) ? retryAt : 0);
        await this.gate.block(until);
        // A received 429 explicitly rejects this request. Persist pending before a later retry.
        if (posting) throw new RejectedPostError('X_RATE_LIMIT', 'X rejected the reply at its rate limit; retry after reset.', until);
        if (attempt >= this.config.maxRetries) throw new BotError('X_RATE_LIMIT', 'X rate limit reached; waiting for reset.', until);
        continue;
      }
      if (response.status >= 500 || response.status === 408) {
        if (posting) throw new AmbiguousPostError();
        if (attempt < this.config.maxRetries) { await this.time.sleep(this.backoff(attempt), signal); continue; }
        throw new BotError('X_UNAVAILABLE', 'X is unavailable after bounded retries.');
      }
      if (!response.ok) {
        const code = response.status === 401 ? 'X_AUTH' : response.status === 403 ? 'X_ACCESS' : response.status === 404 ? 'X_NOT_FOUND' : 'X_REJECTED';
        const message = response.status === 401 ? 'Refresh X_USER_ACCESS_TOKEN outside this worker and restart.' :
          response.status === 403 ? 'Check X app access and tweet.read, users.read, tweet.write, media.write scopes.' : 'X rejected the request; inspect account access and request configuration.';
        if (posting) throw new RejectedPostError(code, message);
        throw new BotError(code, message);
      }
      if (decodeFailed) { if (posting) throw new AmbiguousPostError(); throw new BotError('X_RESPONSE', 'X returned unreadable JSON.'); }
      return payload;
    }
  }
  private backoff(attempt: number) { return Math.min(this.config.maxBackoffMs, this.config.backoffMs * 2 ** attempt); }
  async me(signal: AbortSignal): Promise<Identity> {
    const data = record(record(await this.request('/2/users/me', 'GET', undefined, signal)).data);
    if (!isId(data.id) || typeof data.username !== 'string' || !/^[a-zA-Z0-9_]{1,15}$/.test(data.username)) throw new BotError('X_RESPONSE', 'Cannot verify authenticated bot identity.');
    this.identity = { id: data.id, username: data.username };
    return this.identity;
  }
  async mentions(scan: Scan, signal: AbortSignal): Promise<Page> {
    // Use documented timeline quickstart tweet.fields aliases; accept referenced_posts on read too.
    const query = new URLSearchParams({ 'tweet.fields': 'author_id,entities,referenced_tweets', max_results: String(this.config.pageSize), until_id: scan.untilId });
    if (scan.sinceId) query.set('since_id', scan.sinceId);
    if (scan.nextToken) query.set('pagination_token', scan.nextToken);
    if (!this.identity) throw new BotError('IDENTITY', 'Verify bot identity before polling.');
    const body = record(await this.request(`/2/users/${this.identity.id}/mentions?${query}`, 'GET', undefined, signal));
    if (body.errors !== undefined && (!Array.isArray(body.errors) || body.errors.length)) throw new BotError('X_PARTIAL', 'Partial mentions response; cursor retained for retry.');
    const meta = record(body.meta);
    if (body.data !== undefined && !Array.isArray(body.data) || body.data === undefined && meta.result_count !== 0 || meta.next_token !== undefined && typeof meta.next_token !== 'string') throw new BotError('X_RESPONSE', 'Invalid mentions page; cursor retained.');
    return { data: ((body.data ?? []) as unknown[]).map(parsePost), nextToken: meta.next_token as string | undefined };
  }
  private identity?: Identity;
  async post(id: string, signal: AbortSignal): Promise<Post | null> {
    if (!isId(id)) throw new BotError('X_INPUT', 'Invalid parent post ID.');
    try {
      const body = record(await this.request(`/2/tweets/${id}?tweet.fields=author_id,entities,referenced_tweets`, 'GET', undefined, signal));
      if (!body.data) return null;
      const post = parsePost(body.data);
      if (post.id !== id) throw new BotError('X_RESPONSE', 'Parent lookup returned a different post.');
      return post;
    } catch (error) { if (error instanceof BotError && error.code === 'X_NOT_FOUND') return null; throw error; }
  }
  async upload(png: Buffer, signal: AbortSignal): Promise<string> {
    if (png.length > 5_000_000 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new BotError('CARD_INVALID', 'Card must be a PNG of at most 5 MB.');
    const body = record(await this.request('/2/media/upload', 'POST', { media: png.toString('base64'), media_category: 'tweet_image' }, signal));
    const data = record(body.data);
    if (!isId(data.id)) throw new BotError('X_RESPONSE', 'Media upload returned no usable ID.');
    // PNGs normally finish immediately; never attach an asset still being processed.
    if (data.processing_info && record(data.processing_info).state !== 'succeeded') throw new BotError('MEDIA_PENDING', 'PNG processing has not succeeded; no reply was posted.');
    return data.id;
  }
  async reply(id: string, text: string, mediaId: string | undefined, signal: AbortSignal): Promise<string> {
    if (!isId(id) || mediaId !== undefined && !isId(mediaId)) throw new RejectedPostError('X_INPUT', 'Invalid reply or media ID.');
    const body = await this.request('/2/tweets', 'POST', { text, reply: { in_reply_to_tweet_id: id }, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) }, signal, true);
    try {
      const data = record(record(body).data);
      if (!isId(data.id)) throw new Error('Missing reply ID');
      return data.id;
    } catch { throw new AmbiguousPostError(); }
  }
}
