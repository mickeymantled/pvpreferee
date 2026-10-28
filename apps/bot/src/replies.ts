import { NeedsResolutionError } from '@pvp/pipeline';
import type { Ruling } from '@pvp/shared';
import type { BotConfig } from './config';
import { originalSource } from './input';
import { BotError, type BotRuntime, type Identity, type Post, type PreparedReply } from './types';

export type RuntimeFactory = () => Promise<BotRuntime>;
export type CardRenderer = (ruling: Ruling) => Promise<Buffer>;
export function runtimeFactory(env: NodeJS.ProcessEnv): RuntimeFactory {
  return async () => {
    if (!env.DATABASE_URL || !(env.HELIUS_API_KEY || env.HELIUS_RPC_URL)) {
      throw new BotError('RUNTIME_CONFIG', 'A source candidate requires DATABASE_URL and HELIUS_API_KEY or HELIUS_RPC_URL. Unverified-context fallback needs neither.');
    }
    const { createRuntime } = await import('@pvp/pipeline/runtime');
    return createRuntime({ env });
  };
}
export class ReplyPlanner {
  private runtime?: Promise<BotRuntime>;
  private inflight = new Set<Promise<PreparedReply>>();
  constructor(private readonly config: BotConfig, private readonly factory: RuntimeFactory,
    private readonly render: CardRenderer = async ruling => (await import('@pvp/card')).renderRulingCard(ruling)) {}

  private fallback(cas: string[], context: string, candidate: boolean): PreparedReply {
    const url = new URL('/resolve', this.config.baseUrl);
    url.search = new URLSearchParams({ cas: cas.join('\n'), source_url: context, version: this.config.version }).toString();
    return { kind: 'needs_resolution', text: `${candidate ? 'The candidate source needs review.' : 'Original source needed; linked post is unverified context.'} Review before ruling: ${url.href}` };
  }
  async prepare(mention: Post, parent: Post | null, cas: string[], me: Identity): Promise<PreparedReply> {
    const source = originalSource(mention, parent, me, this.config.baseUrl);
    // /resolve requires source_url. Context is explicitly unverified, never a subject assertion.
    if (!source) return this.fallback(cas, `https://x.com/i/web/status/${parent?.id ?? mention.id}`, false);
    const operation = this.prepareSource(cas, source);
    this.inflight.add(operation);
    void operation.finally(() => this.inflight.delete(operation)).catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BotError('PIPELINE_TIMEOUT', 'Shared pipeline exceeded its deadline. No reply posted; inspect provider availability.')), this.config.pipelineTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  private async prepareSource(cas: string[], source: string): Promise<PreparedReply> {
    try {
      this.runtime ??= this.factory().catch(error => { this.runtime = undefined; throw error; });
      const runtime = await this.runtime;
      const ruling = await runtime.pipeline.run({ cas, source_url: source, version: this.config.version });
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(ruling.share_slug)) throw new BotError('RULING_INVALID', 'Shared pipeline returned an invalid permalink.');
      const labels = {
        resolved: 'PvP Referee ruling ready. See the evidence and rule grid:',
        unresolved: 'Evidence is incomplete; no definitive ruling. Review the grid:',
        separate_memes: 'These are separate memes; no comparative winner. See the evidence:',
        no_winner: 'No winner under this rulebook. See the reasons:',
      };
      if (!(ruling.status in labels) || ruling.status === 'resolved' && !ruling.winner_ca) throw new BotError('RULING_INVALID', 'Shared pipeline returned an inconsistent ruling status.');
      const png = await this.render(ruling);
      if (png.length > 5_000_000 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new BotError('CARD_INVALID', 'Shared card renderer returned an invalid PNG.');
      return { kind: ruling.status, text: `${labels[ruling.status]} ${this.config.baseUrl}/ruling/${ruling.share_slug}`, png: png.toString('base64') };
    } catch (error) {
      if (error instanceof NeedsResolutionError) return this.fallback(cas, source, true);
      throw error;
    }
  }
  async close(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
    if (this.runtime) await (await this.runtime).close();
  }
}
