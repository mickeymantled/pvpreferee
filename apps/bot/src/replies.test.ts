import { describe, expect, it, vi } from 'vitest';
import { NeedsResolutionError } from '@pvp/pipeline';
import { ReplyPlanner, runtimeFactory } from './replies';
import { ca1, ca2, config, me, mention, noSource, png, ruling } from './test-support';

describe('reply preparation', () => {
  it('missing/ambiguous source uses unverified context with valid web parameters, without constructing runtime', async () => {
    const factory = vi.fn(runtimeFactory({}));
    const planner = new ReplyPlanner(config(), factory);
    const reply = await planner.prepare(noSource, null, [ca1, ca2], me);
    expect(factory).not.toHaveBeenCalled();
    expect(reply.kind).toBe('needs_resolution');
    expect(reply.text).toContain('unverified context');
    const link = new URL(reply.text.match(/https:\/\/\S+/)![0]);
    expect(link.pathname).toBe('/resolve');
    expect(link.searchParams.get('cas')).toBe(`${ca1}\n${ca2}`);
    expect(link.searchParams.get('source_url')).toBe(`https://x.com/i/web/status/${noSource.id}`);
    expect(link.searchParams.get('version')).toBe('v1');
    await planner.close();
  });
  it('uses NeedsResolutionError to fall back without rendering or inventing a verdict', async () => {
    const run = vi.fn(async () => { throw new NeedsResolutionError({ meme: null, endorsements: [], needs_review: true, reasons: ['Synthetic unknown subject'] }); });
    const close = vi.fn(async () => undefined);
    const render = vi.fn();
    const planner = new ReplyPlanner(config(), async () => ({ pipeline: { run }, close }), render);
    expect((await planner.prepare(mention, null, [ca1, ca2], me)).text).toContain('candidate source needs review');
    expect(render).not.toHaveBeenCalled();
    await planner.close(); expect(close).toHaveBeenCalledOnce();
  });
  it.each(['resolved', 'unresolved', 'no_winner', 'separate_memes'] as const)('renders shared card and permalink with honest %s status', async status => {
    const result = ruling(status);
    const run = vi.fn(async () => result);
    const render = vi.fn(async () => png);
    const planner = new ReplyPlanner(config(), async () => ({ pipeline: { run }, close: async () => undefined }), render);
    const reply = await planner.prepare(mention, null, [ca1, ca2], me);
    expect(reply).toMatchObject({ kind: status, png: png.toString('base64') });
    expect(reply.text).toContain('/ruling/synthetic-ruling');
    if (status !== 'resolved') expect(reply.text).not.toContain('ruling ready');
    expect(run).toHaveBeenCalledWith({ cas: [ca1, ca2], source_url: 'https://example.org/meme-source', version: 'v1' });
    expect(render).toHaveBeenCalledWith(result);
    await planner.close();
  });
  it('missing runtime env and provider failures are actionable failures, never unresolved verdicts', async () => {
    const planner = new ReplyPlanner(config(), runtimeFactory({}));
    await expect(planner.prepare(mention, null, [ca1, ca2], me)).rejects.toMatchObject({ code: 'RUNTIME_CONFIG' });
    await planner.close();
    const broken = new ReplyPlanner(config(), async () => { throw new Error('secret provider detail'); });
    await expect(broken.prepare(mention, null, [ca1, ca2], me)).rejects.toThrow('secret provider detail');
  });
  it('bounds a hanging pipeline and closes it after outstanding work settles', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: ReturnType<typeof ruling>) => void;
      const close = vi.fn(async () => undefined);
      const planner = new ReplyPlanner({ ...config(), pipelineTimeoutMs: 10 }, async () => ({ pipeline: { run: () => new Promise(resolve => { finish = resolve; }) }, close }), async () => png);
      const pending = expect(planner.prepare(mention, null, [ca1, ca2], me)).rejects.toMatchObject({ code: 'PIPELINE_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(10); await pending;
      finish(ruling()); await planner.close(); expect(close).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
