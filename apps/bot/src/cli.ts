import { readConfig } from './config';
import { ReplyPlanner, runtimeFactory } from './replies';
import { StateStore } from './state';
import { BotError } from './types';
import { Worker } from './worker';
import { XClient } from './x-api';

export function installShutdown(controller: AbortController, graceMs: number, host = process): () => void {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    // The shared pipeline has no AbortSignal contract. Bound shutdown even if a provider hangs.
    deadline = setTimeout(() => host.exit(1), graceMs);
    deadline.unref();
  };
  host.on('SIGINT', stop); host.on('SIGTERM', stop);
  return () => { host.off('SIGINT', stop); host.off('SIGTERM', stop); clearTimeout(deadline); };
}
export async function main(env: NodeJS.ProcessEnv, args: string[] = []): Promise<void> {
  if (args.length && !((args[0] === '--ack-post' && args.length === 3) || (args[0] === '--abandon' && args.length === 2) || (args[0] === '--prune-terminal' && args.length === 1))) {
    throw new BotError('CLI', 'Use no arguments, --ack-post MENTION_ID VERIFIED_REPLY_ID, --abandon MENTION_ID, or --prune-terminal.');
  }
  const config = readConfig(env);
  const store = await StateStore.open(config.statePath, config.send ? 'send' : 'dry_run', config.sinceId);
  if (args.length) {
    try {
      if (args[0] === '--prune-terminal') console.info(`Pruned ${await store.pruneTerminal()} completed records; cursor and uncertain submissions retained.`);
      else await store.reconcile(args[1]!, args[0] === '--ack-post' ? args[2]! : null);
    }
    finally { await store.close(); }
    return;
  }
  const controller = new AbortController();
  const detach = installShutdown(controller, config.shutdownMs);
  const api = new XClient(config, { until: () => store.data.blockedUntil, block: async until => {
    store.data.blockedUntil = Math.max(store.data.blockedUntil, until); await store.save();
  } });
  const worker = new Worker(config, api, store, new ReplyPlanner(config, runtimeFactory(env)),
    (event, id) => console.info(JSON.stringify({ event, ...(id ? { mention_id: id } : {}) })));
  console.info(config.send ? 'PvP Referee send mode; durable outbox enabled.' : 'PvP Referee dry-run; no X uploads or replies. This state cannot be reused for send mode.');
  try { await worker.run(controller.signal); } finally { detach(); }
}
