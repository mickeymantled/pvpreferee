import { readFile, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installShutdown } from './cli';
import { ReplyPlanner } from './replies';
import { StateStore } from './state';
import { Worker } from './worker';
import { AmbiguousPostError, RejectedPostError, type Job, type PreparedReply } from './types';
import { ca1, ca2, config, fakeApi, fakeClock, me, mention, noSource, parent, parentMention, png, signal, statePath } from './test-support';

const prepared: PreparedReply = { text: 'Synthetic ruling: https://ref.example.org/ruling/synthetic', kind: 'resolved', png: png.toString('base64') };
const planner = () => ({ prepare: vi.fn(async () => structuredClone(prepared)), close: vi.fn(async () => undefined) });
const job = (status: Job['status'] = 'queued'): Job => ({ post: structuredClone(mention), status, attempts: 0, nextAttemptAt: 0,
  ...(status === 'queued' ? {} : { prepared: structuredClone(prepared) }) });

describe('durable worker lifecycle', () => {
  it('sends card+link once and dedupes after restart', async () => {
    const path = await statePath(); let store = await StateStore.open(path, 'send');
    const api = fakeApi(); vi.mocked(api.mentions).mockResolvedValue({ data: [mention] });
    const plan = planner(); const worker = new Worker(config(), api, store, plan);
    await worker.initialize(signal()); await worker.tick(signal());
    expect(api.upload).toHaveBeenCalledWith(png, expect.any(AbortSignal));
    expect(api.reply).toHaveBeenCalledWith(mention.id, prepared.text, '500', expect.any(AbortSignal));
    expect(store.data.jobs[mention.id]).toMatchObject({ status: 'sent', replyId: '600' });
    expect(store.data.jobs[mention.id]!.prepared!.png).toBeUndefined();
    await store.close(); store = await StateStore.open(path, 'send');
    vi.mocked(api.mentions).mockResolvedValue({ data: [] });
    const restarted = new Worker(config(), api, store, plan);
    await restarted.initialize(signal()); await restarted.tick(signal());
    expect(api.reply).toHaveBeenCalledOnce(); expect(plan.prepare).toHaveBeenCalledOnce(); await store.close();
  });
  it('extracts parent addresses, uses the source planner, and skips invalid/self/implicit mentions', async () => {
    const store = await StateStore.open(await statePath(), 'send');
    const api = fakeApi();
    vi.mocked(api.post).mockResolvedValue(parent);
    vi.mocked(api.mentions).mockResolvedValue({ data: [parentMention, { ...mention, id: '104', author_id: me.id }, { ...mention, id: '105', text: '@pvpreferee bad' }, { ...mention, id: '106', entities: {} }] });
    const plan = planner(); const worker = new Worker(config(), api, store, plan);
    await worker.initialize(signal()); await worker.tick(signal());
    expect(api.post).toHaveBeenCalledWith('90', expect.any(AbortSignal));
    expect(plan.prepare).toHaveBeenCalledWith(parentMention, parent, [ca1, ca2], me);
    expect(api.reply).toHaveBeenCalledOnce();
    expect(['104', '105', '106'].map(id => store.data.jobs[id]!.status)).toEqual(['skipped', 'skipped', 'skipped']);
    await store.close();
  });
  it('sends /resolve fallback without database/Helius/runtime or media upload', async () => {
    const store = await StateStore.open(await statePath(), 'send');
    const api = fakeApi(); vi.mocked(api.mentions).mockResolvedValue({ data: [noSource] });
    const factory = vi.fn(async () => { throw new Error('Must stay lazy'); });
    const worker = new Worker(config(), api, store, new ReplyPlanner(config(), factory));
    await worker.initialize(signal()); await worker.tick(signal());
    expect(api.upload).not.toHaveBeenCalled(); expect(factory).not.toHaveBeenCalled();
    expect(vi.mocked(api.reply).mock.calls[0]![1]).toContain('/resolve?cas=');
    await store.close();
  });
  it('checkpoints paginated inbox and resumes with the SAME bounds/token before advancing since_id', async () => {
    const path = await statePath(); let store = await StateStore.open(path, 'send', '99');
    const api = fakeApi(); const plan = planner();
    vi.mocked(api.mentions).mockResolvedValueOnce({ data: [mention], nextToken: 'page2' });
    let worker = new Worker({ ...config(), pagesPerTick: 1 }, api, store, plan);
    await worker.initialize(signal()); await worker.tick(signal());
    expect(store.data.sinceId).toBe('99');
    const firstScan = structuredClone(store.data.scan);
    await store.close(); store = await StateStore.open(path, 'send', '999');
    vi.mocked(api.mentions).mockResolvedValueOnce({ data: [noSource] });
    worker = new Worker(config(), api, store, plan);
    await worker.initialize(signal()); await worker.tick(signal());
    expect(vi.mocked(api.mentions).mock.calls[1]![0]).toEqual(firstScan);
    expect(store.data.sinceId).toBe(mention.id); expect(store.data.scan).toBeUndefined();
    expect(api.reply).toHaveBeenCalledTimes(2); await store.close();
  });
  it('does not advance past a failed page; saved inbox is replayed without skipped mentions', async () => {
    const path = await statePath(); let store = await StateStore.open(path, 'send', '99');
    const api = fakeApi();
    vi.mocked(api.mentions).mockResolvedValueOnce({ data: [mention], nextToken: 'page2' }).mockRejectedValueOnce(new Error('offline'));
    const worker = new Worker(config(), api, store, planner());
    await worker.initialize(signal()); await expect(worker.tick(signal())).rejects.toThrow('offline');
    expect(store.data.sinceId).toBe('99'); expect(store.data.jobs[mention.id]!.status).toBe('queued');
    await store.close(); store = await StateStore.open(path, 'send');
    vi.mocked(api.mentions).mockResolvedValueOnce({ data: [noSource] });
    const restarted = new Worker(config(), api, store, planner());
    await restarted.initialize(signal()); await restarted.tick(signal());
    expect(api.reply).toHaveBeenCalledTimes(2); expect(store.data.sinceId).toBe('103'); await store.close();
  });
  it('persists submitted BEFORE sending and does not resend an ambiguous post on restart', async () => {
    const path = await statePath(); let store = await StateStore.open(path, 'send');
    const api = fakeApi(); vi.mocked(api.mentions).mockResolvedValueOnce({ data: [mention] });
    vi.mocked(api.reply).mockImplementation(async () => {
      const disk = JSON.parse(await readFile(path, 'utf8'));
      expect(disk.state.jobs[mention.id].status).toBe('submitted');
      throw new AmbiguousPostError();
    });
    const worker = new Worker(config(), api, store, planner());
    await worker.initialize(signal()); await worker.tick(signal());
    expect(store.data.jobs[mention.id]!.status).toBe('submitted');
    await store.close(); store = await StateStore.open(path, 'send');
    const report = vi.fn(); const restarted = new Worker(config(), api, store, planner(), report);
    await restarted.initialize(signal()); await restarted.tick(signal());
    expect(api.reply).toHaveBeenCalledOnce(); expect(report).toHaveBeenCalledWith('SUBMITTED_NEEDS_RECONCILIATION', mention.id);
    await store.reconcile(mention.id, '601'); expect(store.data.jobs[mention.id]!.replyId).toBe('601'); await store.close();
  });
  it('recovers pending preparations without rerunning pipeline, and never retries crash-left submitted markers', async () => {
    const store = await StateStore.open(await statePath(), 'send');
    store.data.jobs['103'] = job('pending'); store.data.jobs['104'] = { ...job('submitted'), post: { ...mention, id: '104' } }; await store.save();
    const api = fakeApi(); const plan = planner(); const worker = new Worker(config(), api, store, plan);
    await worker.initialize(signal()); await worker.tick(signal());
    expect(plan.prepare).not.toHaveBeenCalled(); expect(api.reply).toHaveBeenCalledOnce();
    await store.reconcile('104', null); expect(store.data.jobs['104']!.status).toBe('skipped'); await store.close();
  });
  it('requeues explicitly rejected 429 posts only after their reset', async () => {
    const store = await StateStore.open(await statePath(), 'send');
    const time = fakeClock(); const api = fakeApi();
    vi.mocked(api.mentions).mockResolvedValueOnce({ data: [mention] });
    vi.mocked(api.reply).mockRejectedValueOnce(new RejectedPostError('X_RATE_LIMIT', 'synthetic rejection', time.now() + 60_000)).mockResolvedValue('601');
    const worker = new Worker(config(), api, store, planner(), undefined, time);
    await worker.initialize(signal()); await worker.tick(signal());
    expect(store.data.jobs[mention.id]!.status).toBe('pending');
    await worker.tick(signal()); expect(api.reply).toHaveBeenCalledOnce();
    time.value += 60_000; await worker.tick(signal());
    expect(api.reply).toHaveBeenCalledTimes(2); expect(store.data.jobs[mention.id]!.status).toBe('sent'); await store.close();
  });
  it('persists author/account quotas across restart', async () => {
    const path = await statePath(); let store = await StateStore.open(path, 'send');
    const api = fakeApi(); const time = fakeClock();
    vi.mocked(api.mentions).mockResolvedValueOnce({ data: [mention, { ...mention, id: '104' }] });
    const limited = { ...config(), authorQuota: 1 };
    let worker = new Worker(limited, api, store, planner(), undefined, time);
    await worker.initialize(signal()); await worker.tick(signal()); expect(api.reply).toHaveBeenCalledOnce();
    await store.close(); store = await StateStore.open(path, 'send');
    worker = new Worker(limited, api, store, planner(), undefined, time);
    await worker.initialize(signal()); await worker.tick(signal()); expect(api.reply).toHaveBeenCalledOnce();
    time.value += limited.quotaWindowMs; await worker.tick(signal()); expect(api.reply).toHaveBeenCalledTimes(2); await store.close();
  });
  it('dry-run never uploads/posts and its persistent dedupe cannot be mistaken for send success', async () => {
    const path = await statePath(); const store = await StateStore.open(path, 'dry_run');
    const api = fakeApi(); vi.mocked(api.mentions).mockResolvedValueOnce({ data: [mention] });
    const worker = new Worker({ ...config(), send: false }, api, store, planner());
    await worker.initialize(signal()); await worker.tick(signal());
    expect(api.reply).not.toHaveBeenCalled(); expect(api.upload).not.toHaveBeenCalled();
    expect(store.data.jobs[mention.id]!.status).toBe('dry_run'); await store.close();
    await expect(StateStore.open(path, 'send')).rejects.toMatchObject({ code: 'STATE_INVALID' });
  });
  it('fails duplicate workers closed, detects corruption, and releases a clean lock', async () => {
    const path = await statePath(); const store = await StateStore.open(path, 'send');
    await expect(StateStore.open(path, 'send')).rejects.toMatchObject({ code: 'STATE_LOCKED' });
    await store.close(); const again = await StateStore.open(path, 'send'); await again.close();
    await writeFile(path, '{"broken":');
    await expect(StateStore.open(path, 'send')).rejects.toMatchObject({ code: 'STATE_INVALID' });
  });
  it('stops on wrong authenticated identity before polling', async () => {
    const store = await StateStore.open(await statePath(), 'send'); const api = fakeApi();
    vi.mocked(api.me).mockResolvedValue({ id: '999', username: 'wrong_bot' });
    await expect(new Worker(config(), api, store, planner()).run(signal())).rejects.toMatchObject({ code: 'IDENTITY' });
    expect(api.mentions).not.toHaveBeenCalled();
  });
  it('SIGINT/SIGTERM abort sleeps, close runtime, and release lock without publishing queued work', async () => {
    const path = await statePath(); const store = await StateStore.open(path, 'send');
    const api = fakeApi(); const plan = planner(); const controller = new AbortController();
    const events = new EventEmitter() as NodeJS.Process; events.exit = vi.fn() as unknown as NodeJS.Process['exit'];
    const detach = installShutdown(controller, 1000, events);
    vi.mocked(api.mentions).mockImplementation(async () => { events.emit('SIGTERM'); return { data: [mention] }; });
    await new Worker(config(), api, store, plan).run(controller.signal); detach();
    expect(controller.signal.aborted).toBe(true); expect(api.reply).not.toHaveBeenCalled(); expect(plan.close).toHaveBeenCalledOnce();
    const reopened = await StateStore.open(path, 'send'); expect(reopened.data.jobs[mention.id]!.status).toBe('queued'); await reopened.close();
    expect(events.listenerCount('SIGINT')).toBe(0); expect(events.listenerCount('SIGTERM')).toBe(0);
  });
});
