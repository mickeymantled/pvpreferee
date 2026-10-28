import { describe, expect, it, vi } from 'vitest';
import { XClient, type Transport } from './x-api';
import { config, fakeClock, fixtures, png, signal } from './test-support';
import { diagnostic } from './types';

const response = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function client(transport: Transport, options = {}) {
  const time = fakeClock();
  let until = 0;
  const block = vi.fn(async (at: number) => { until = Math.max(until, at); });
  return { api: new XClient({ ...config(), ...options }, { until: () => until, block }, transport, time), time, block };
}
describe('X v2 injected transport', () => {
  it('authenticates, requests mention fields/pagination, and fetches the actual parent', async () => {
    const transport = vi.fn<Transport>()
      .mockResolvedValueOnce(response(fixtures.me)).mockResolvedValueOnce(response(fixtures.page1)).mockResolvedValueOnce(response(fixtures.parent));
    const { api } = client(transport);
    await api.me(signal());
    expect(await api.mentions({ sinceId: '99', untilId: '200', nextToken: 'saved-token', tokens: [] }, signal())).toMatchObject({ nextToken: 'synthetic-next' });
    const url = new URL(transport.mock.calls[1]![0]);
    expect(url.pathname).toBe('/2/users/900/mentions');
    expect(url.searchParams.get('since_id')).toBe('99');
    expect(url.searchParams.get('until_id')).toBe('200');
    expect(url.searchParams.get('pagination_token')).toBe('saved-token');
    expect(url.searchParams.get('tweet.fields')).toContain('referenced_tweets');
    expect(await api.post('90', signal())).toMatchObject({ id: '90' });
    expect(transport.mock.calls[0]![1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer SYNTHETIC_NOT_A_CREDENTIAL' } });
  });
  it('uploads PNG bytes via JSON and replies with media ID and in_reply_to_tweet_id', async () => {
    const transport = vi.fn<Transport>().mockResolvedValueOnce(response(fixtures.upload)).mockResolvedValueOnce(response(fixtures.reply, 201));
    const { api } = client(transport);
    const mediaId = await api.upload(png, signal());
    expect(await api.reply('103', 'Synthetic card https://ref.example.org/ruling/synthetic', mediaId, signal())).toBe('600');
    expect(transport.mock.calls[0]![0]).toBe('https://api.x.com/2/media/upload');
    expect(JSON.parse(transport.mock.calls[0]![1].body as string)).toEqual({ media: png.toString('base64'), media_category: 'tweet_image' });
    expect(JSON.parse(transport.mock.calls[1]![1].body as string)).toMatchObject({ reply: { in_reply_to_tweet_id: '103' }, media: { media_ids: ['500'] } });
  });
  it('respects 429 reset and Retry-After without truncating the wait to the backoff cap', async () => {
    const reset = Math.floor(fakeClock().now() / 1000) + 120;
    const transport = vi.fn<Transport>().mockResolvedValueOnce(response(fixtures.rateLimit, 429, { 'x-rate-limit-reset': String(reset), 'retry-after': '180' }))
      .mockResolvedValueOnce(response(fixtures.me));
    const { api, time, block } = client(transport, { maxBackoffMs: 20 });
    await api.me(signal());
    expect(time.sleeps).toEqual([180_000]); expect(block).toHaveBeenCalledOnce();
  });
  it('honors successful response remaining=0 before the next call', async () => {
    const reset = Math.floor(fakeClock().now() / 1000) + 60;
    const transport = vi.fn<Transport>().mockResolvedValueOnce(response(fixtures.me, 200, { 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': String(reset) }))
      .mockResolvedValueOnce(response(fixtures.parent));
    const { api, time } = client(transport);
    await api.me(signal()); await api.post('90', signal()); expect(time.sleeps).toEqual([61_000]);
  });
  it('bounds transient read retries with exponential backoff', async () => {
    const transport = vi.fn<Transport>().mockRejectedValue(new Error('secret'));
    const { api, time } = client(transport, { maxRetries: 2, backoffMs: 10, maxBackoffMs: 100 });
    await expect(api.me(signal())).rejects.toMatchObject({ code: 'X_NETWORK' });
    expect(transport).toHaveBeenCalledTimes(3); expect(time.sleeps).toEqual([10, 20]);
  });
  it.each(['network', '5xx', 'malformed'])('does not retry an ambiguous %s post', async kind => {
    const transport = vi.fn<Transport>();
    if (kind === 'network') transport.mockRejectedValue(new Error('private response'));
    else transport.mockResolvedValue(response(kind === '5xx' ? {} : { data: {} }, kind === '5xx' ? 503 : 201));
    const { api } = client(transport);
    await expect(api.reply('103', 'test', undefined, signal())).rejects.toMatchObject({ code: 'POST_AMBIGUOUS' });
    expect(transport).toHaveBeenCalledOnce();
  });
  it('returns an explicitly rejected 429 post to the durable pending queue instead of retrying inside HTTP', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(response(fixtures.rateLimit, 429, { 'retry-after': '30' }));
    const { api, time } = client(transport);
    await expect(api.reply('103', 'test', undefined, signal())).rejects.toMatchObject({ code: 'X_RATE_LIMIT', retryAt: time.now() + 30_000 });
    expect(transport).toHaveBeenCalledOnce();
  });
  it('uses bounded request timeouts and supports cancellation', async () => {
    vi.useFakeTimers();
    try {
      const transport: Transport = async (_url, init) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      const { api } = client(transport, { timeoutMs: 10, maxRetries: 0 });
      const pending = expect(api.me(signal())).rejects.toMatchObject({ code: 'X_NETWORK' });
      await vi.advanceTimersByTimeAsync(10); await pending;
      const controller = new AbortController();
      const posting = expect(api.reply('103', 'test', undefined, controller.signal)).rejects.toMatchObject({ code: 'POST_AMBIGUOUS' });
      controller.abort(); await posting;
    } finally { vi.useRealTimers(); }
  });
  it('rejects partial/malformed pages, mismatched parents and unprocessed media', async () => {
    const transport = vi.fn<Transport>().mockResolvedValueOnce(response(fixtures.me))
      .mockResolvedValueOnce(response({ ...fixtures.page1, errors: [{ detail: 'synthetic partial' }] }))
      .mockResolvedValueOnce(response({ data: { ...fixtures.parent.data, id: '91' } }))
      .mockResolvedValueOnce(response({ data: { id: '500', processing_info: { state: 'pending' } } }));
    const { api } = client(transport); await api.me(signal());
    await expect(api.mentions({ untilId: '200', tokens: [] }, signal())).rejects.toMatchObject({ code: 'X_PARTIAL' });
    await expect(api.post('90', signal())).rejects.toMatchObject({ code: 'X_RESPONSE' });
    await expect(api.upload(png, signal())).rejects.toMatchObject({ code: 'MEDIA_PENDING' });
  });
  it('sanitizes credential and provider diagnostics', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(response({ detail: 'SENSITIVE_TOKEN_WITH_URL' }, 401));
    const { api } = client(transport);
    try { await api.me(signal()); } catch (error) {
      expect(diagnostic(error)).toContain('Refresh X_USER_ACCESS_TOKEN');
      expect(diagnostic(error)).not.toContain('SENSITIVE');
    }
    expect(diagnostic(new Error('SENSITIVE_TOKEN_WITH_URL'))).not.toContain('SENSITIVE');
  });
});
