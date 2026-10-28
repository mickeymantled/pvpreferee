import type { MemeRecord, Rulebook, SourceResolution } from '@pvp/shared';
import { discoveryUrl, originLinks } from './discovery-links.js';
import { isSolanaAddress, record } from './parse.js';
import { createPublicTransport, publicUrl, responseText, SourceError, type SourceTransport, type TransportResponse } from './transport.js';

export interface OriginCandidate {
  url: string;
  coin_cas: string[];
  discovered_via: string[];
  status: 'unverified' | 'confirmed' | 'needs_review';
  reasons: string[];
}
export interface OriginDiscoveryResult { resolution: SourceResolution; candidates: OriginCandidate[]; notes: string[] }
export interface OriginDiscoveryOptions {
  transport?: SourceTransport;
  resolve: (url: string, config: Rulebook) => Promise<SourceResolution>;
}

const NETWORK_MS = 4_000;
const RESOLVE_MS = 9_000;
const TOTAL_MS = 28_000;
const MAX_BYTES = 1024 * 1024;
const MAX_CANDIDATES = 10;
const CONCURRENCY = 3;
const MAX_PAIRS = 100;
const MAX_LINKS_PER_FIELD = 20;
const PROVENANCE_ONLY = 'DexScreener listings and page links are discovery provenance only; they do not establish canonical identity or endorsement.';
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

interface CandidateState {
  candidate: OriginCandidate;
  html: boolean;
  direct: boolean;
  expanded: boolean;
  inspectionFailed?: boolean;
  finalUrl?: string;
  targets: Set<string>;
  resolution?: SourceResolution;
}

async function deadline<T>(run: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(run), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new SourceError('TIMEOUT', 'Discovery deadline exceeded.')), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function concurrent<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) await run(items[next++]!);
  }));
}

/** Do not return exception messages, response bodies, credentials or arbitrary error codes. */
function failure(error: unknown): string {
  const messages: Record<string, string> = {
    TIMEOUT: 'deadline exceeded', TOO_LARGE: 'response exceeds the 1 MiB limit',
    UNSAFE_URL: 'unsafe URL rejected', UNSAFE_ADDRESS: 'non-public DNS address rejected',
    REDIRECT: 'unsafe, unexpected or excessive redirect rejected', HTTP: 'HTTP request failed (access, quota or availability)',
    CONTENT_TYPE: 'unsupported response content type', ENCODING: 'unsupported response encoding',
    PARTIAL: 'partial or truncated response rejected', PROVIDER_DATA: 'invalid provider response',
  };
  return error instanceof SourceError && Object.hasOwn(messages, error.code)
    ? messages[error.code]! : 'request or parsing failed';
}

async function get(transport: SourceTransport, url: string, api: boolean, timeoutMs: number): Promise<TransportResponse> {
  const result = await deadline(() => transport.get(url, api ? { allowRedirects: false } : undefined), timeoutMs);
  const finalUrl = publicUrl(result.url).href;
  if (api && finalUrl !== url || new URL(url).protocol === 'https:' && new URL(finalUrl).protocol !== 'https:') {
    throw new SourceError('REDIRECT', 'Unexpected redirect.');
  }
  if (result.status === 206 || result.headers['content-range']) throw new SourceError('PARTIAL', 'Partial response.');
  if (result.status < 200 || result.status >= 300) throw new SourceError('HTTP', 'HTTP failure.');
  if (result.body.byteLength > MAX_BYTES) throw new SourceError('TOO_LARGE', 'Response too large.');
  const length = result.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) !== result.body.byteLength)) {
    throw new SourceError('PARTIAL', 'Incomplete response.');
  }
  if (result.headers['content-encoding'] && result.headers['content-encoding'] !== 'identity') {
    throw new SourceError('ENCODING', 'Unsupported encoding.');
  }
  return { ...result, url: finalUrl };
}

function identity(meme: MemeRecord): string {
  // IDs, source URLs/tiers and citation counts are not identity. Differences in
  // any supplied rule input remain ambiguous, even when names/tickers agree.
  return JSON.stringify([meme.canonical_name, meme.canonical_ticker, meme.scope, meme.subject_handle,
    meme.home_chain, meme.implied_pair, meme.source_launchpad, meme.beneficiary_wallet,
    meme.beneficiary_tie_at, meme.source_image_hash, meme.source_image_hash ? null : meme.source_image_url]);
}

/** Bounded discovery only; the injected authority/override resolver remains the sole verifier. */
export async function discoverOrigin(cas: string[], config: Rulebook, options: OriginDiscoveryOptions): Promise<OriginDiscoveryResult> {
  const started = performance.now();
  const remaining = (): number => Math.max(0, Math.floor(TOTAL_MS - (performance.now() - started)));
  // An injected callback cannot be cancelled by this interface. After a timeout,
  // stop launching work so timed-out promises cannot multiply I/O concurrency.
  let timedOut = false;
  const notes = new Set<string>([PROVENANCE_ONLY]);
  const blockers = new Set<string>();
  let states = new Map<string, CandidateState>();
  const review = (): OriginDiscoveryResult => ({
    resolution: { meme: null, endorsements: [], needs_review: true, reasons: sorted(blockers) },
    candidates: output(), notes: sorted(notes),
  });
  function output(): OriginCandidate[] {
    return [...states.values()].map(({ candidate }) => ({ ...candidate,
      coin_cas: sorted(candidate.coin_cas), discovered_via: sorted(candidate.discovered_via), reasons: sorted(candidate.reasons),
    })).sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
  }
  if (!Array.isArray(cas) || cas.length < 2 || cas.length > 10 || cas.some(ca => typeof ca !== 'string' || !isSolanaAddress(ca))) {
    blockers.add('Supply 2–10 Solana contract addresses that each decode to exactly 32 bytes.'); return review();
  }
  const requested = sorted(cas);
  if (requested.length < 2) { blockers.add('Supply at least two distinct Solana contract addresses.'); return review(); }
  if (requested.length !== cas.length) notes.add('Duplicate contract addresses were deduplicated.');
  const endpoint = `https://api.dexscreener.com/tokens/v1/solana/${requested.join(',')}`;
  const transport = options.transport ?? { get: (url, fetchOptions) => createPublicTransport({
    timeoutMs: Math.max(1, Math.min(NETWORK_MS, remaining())), maxBytes: MAX_BYTES, maxRedirects: 3,
  }).get(url, fetchOptions) } satisfies SourceTransport;
  let pairs: unknown[];
  try {
    const payload: unknown = JSON.parse(responseText(await get(transport, endpoint, true, Math.min(NETWORK_MS, remaining())), 'json'));
    if (!Array.isArray(payload)) throw new SourceError('PROVIDER_DATA', 'Expected an array of pairs.');
    pairs = payload;
  } catch (error) {
    blockers.add(`DexScreener discovery unavailable: ${failure(error)}. Retry or review an explicit source.`); return review();
  }
  if (pairs.length > MAX_PAIRS) {
    blockers.add(`Discovery truncated: provider returned more than ${MAX_PAIRS} pairs.`);
    // Never auto-ready after truncation; sorting keeps inspected output independent of response order.
    pairs = pairs.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))).slice(0, MAX_PAIRS);
  }
  function add(raw: unknown, coinCas: string[], via: string[], direct: boolean, context: string): CandidateState | undefined {
    if (typeof raw !== 'string' || !raw.trim()) {
      notes.add(`${context}: no usable URL field; handles are never converted into URLs.`); return;
    }
    let parsed: ReturnType<typeof discoveryUrl>;
    try { parsed = discoveryUrl(raw); }
    catch {
      notes.add(`${context}: unsafe, unsupported profile/listing or non-document URL excluded.`); return;
    }
    const existing = states.get(parsed.url);
    if (existing) {
      existing.candidate.coin_cas.push(...coinCas); existing.candidate.discovered_via.push(...via);
      existing.direct ||= direct; return existing;
    }
    const state: CandidateState = { candidate: { url: parsed.url, coin_cas: [...coinCas], discovered_via: [...via],
      status: 'unverified', reasons: [] }, html: parsed.html, direct, expanded: false, targets: new Set() };
    states.set(parsed.url, state); return state;
  }
  const matched = new Set<string>();
  for (const pairValue of pairs) {
    const pair = record(pairValue);
    const ca = record(pair.baseToken).address;
    if (pair.chainId !== 'solana' || typeof ca !== 'string' || !requested.includes(ca)) continue;
    matched.add(ca);
    const info = record(pair.info);
    for (const field of ['websites', 'socials'] as const) {
      if (info[field] == null) continue;
      if (!Array.isArray(info[field])) {
        blockers.add(`Incomplete discovery for ${ca}: malformed ${field}.`); continue;
      }
      let links: unknown[] = info[field];
      if (links.length > MAX_LINKS_PER_FIELD) {
        blockers.add(`Discovery truncated for ${ca}: more than ${MAX_LINKS_PER_FIELD} ${field} entries.`);
        links = links.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))).slice(0, MAX_LINKS_PER_FIELD);
      }
      for (const link of links) {
        const state = add(record(link).url, [ca], [endpoint], true, `Base mint ${ca}; info.${field}`);
        state?.candidate.reasons.push(`Listed for exact Solana base mint ${ca} in info.${field}; discovery provenance only.`);
      }
    }
  }
  for (const ca of requested) {
    if (!matched.has(ca)) blockers.add(`No Solana base-token pair returned for ${ca}; quote-token matches do not count.`);
    else if (![...states.values()].some(state => state.candidate.coin_cas.includes(ca))) {
      blockers.add(`No supported source-document URL was listed for ${ca}.`);
    }
  }
  function bound(): void {
    if (states.size > MAX_CANDIDATES) {
      blockers.add(`Discovery truncated: more than ${MAX_CANDIDATES} candidate URLs; no automatic selection is safe.`);
      states = new Map([...states].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, MAX_CANDIDATES));
    }
  }
  bound();
  // Freeze the direct roots before adding references. A referenced page is never expanded recursively.
  const roots = [...states.values()].filter(state => state.direct && state.html)
    .sort((a, b) => a.candidate.url < b.candidate.url ? -1 : 1);
  // Freeze per-root provenance too: a concurrent reference must not create a two-hop path.
  const rootInputs = roots.map(state => ({ state, cas: sorted(state.candidate.coin_cas) }));
  await concurrent(rootInputs, async ({ state, cas: rootCas }) => {
    if (timedOut || !remaining()) {
      blockers.add(`Discovery budget exhausted; link inspection skipped for ${state.candidate.url}.`); return;
    }
    try {
      const response = await get(transport, state.candidate.url, false, Math.min(NETWORK_MS, remaining()));
      if (!discoveryUrl(response.url).html) throw new SourceError('REDIRECT', 'HTML root redirected to a provider document.');
      state.finalUrl = response.url;
      const links = originLinks(responseText(response, 'html'));
      state.expanded = true;
      if (response.url !== state.candidate.url) {
        state.candidate.discovered_via.push(state.candidate.url, response.url);
        state.candidate.reasons.push(`Observed public redirect: ${state.candidate.url} -> ${response.url}.`);
      }
      if (links.truncated) blockers.add(`Discovery truncated: more than 500 links on ${state.candidate.url}.`);
      for (const href of links.hrefs) {
        let absolute: string;
        try { absolute = new URL(href, response.url).href; }
        catch { blockers.add(`Incomplete discovery: invalid explicit source link on ${state.candidate.url}.`); continue; }
        // Ignore self-references; they cannot satisfy the intermediary exception below.
        if (absolute === state.candidate.url || absolute === response.url) continue;
        for (const ca of rootCas) {
          const target = add(absolute, [ca], [endpoint, state.candidate.url, response.url], false,
            `Base mint ${ca}; explicit source link on ${state.candidate.url}`);
          if (target && target !== state) {
            state.targets.add(target.candidate.url);
            target.candidate.reasons.push(`Discovery path for ${ca}: ${state.candidate.url} -> ${response.url} -> ${target.candidate.url} (explicit source link, not authority).`);
          }
          else if (!target) blockers.add(`Incomplete discovery: unsafe or unsupported explicit source link on ${state.candidate.url}.`);
        }
      }
    } catch (error) {
      state.inspectionFailed = true;
      if (error instanceof SourceError && error.code === 'TIMEOUT') timedOut = true;
      const reason = `Link inspection incomplete for ${state.candidate.url}: ${failure(error)}.`;
      state.candidate.reasons.push(reason); blockers.add(reason);
    }
  });
  bound();
  await concurrent([...states.values()].sort((a, b) => a.candidate.url < b.candidate.url ? -1 : 1), async state => {
    if (state.inspectionFailed) { state.candidate.status = 'needs_review'; return; }
    if (timedOut || !remaining()) {
      const reason = `Discovery budget exhausted; candidate resolution skipped for ${state.candidate.url}.`;
      state.candidate.reasons.push(reason); blockers.add(reason); return;
    }
    try {
      const resolution = await deadline(() => options.resolve(state.candidate.url, config), Math.min(RESOLVE_MS, remaining()));
      state.candidate.reasons.push(...resolution.reasons);
      if (resolution.needs_review || resolution.meme?.resolved !== true) {
        state.candidate.status = 'needs_review';
        state.candidate.reasons.push('The authority resolver did not independently confirm complete source metadata.'); return;
      }
      const sourceUrl = discoveryUrl(resolution.meme.source_url).url;
      if (sourceUrl !== state.candidate.url && sourceUrl !== state.finalUrl) {
        state.candidate.status = 'needs_review';
        state.candidate.reasons.push('Resolver source URL has no observed direct, redirect or one-hop provenance for this candidate.'); return;
      }
      state.resolution = resolution;
      state.candidate.status = 'confirmed';
      state.candidate.reasons.push('Independently confirmed by the configured authority resolver; listing/link frequency was not used as authority.');
    } catch (error) {
      if (error instanceof SourceError && error.code === 'TIMEOUT') timedOut = true;
      state.candidate.status = 'needs_review';
      const reason = `Candidate resolution incomplete for ${state.candidate.url}: ${failure(error)}.`;
      state.candidate.reasons.push(reason); blockers.add(reason);
    }
  });
  const confirmed = [...states.values()].filter(state => state.resolution?.meme);
  for (const state of states.values()) {
    if (state.resolution) continue;
    // A successfully explored token website can serve only as a reference path
    // to verified source documents. It supplies no facts of its own.
    if (state.expanded && state.targets.size && [...state.targets].every(url => states.get(url)?.resolution)) {
      state.candidate.reasons.push('Used only as an intermediary linking explicitly to independently verified source documents.');
    } else blockers.add(`Unconfirmed candidate leaves discovery incomplete: ${state.candidate.url}.`);
  }
  if (!confirmed.length) blockers.add('No candidate was independently verified as a complete meme source.');
  if (new Set(confirmed.map(state => identity(state.resolution!.meme!))).size > 1) {
    blockers.add('Independently verified candidates have conflicting identities or rule inputs; source ambiguity requires review.');
  }
  // Redirect aliases may converge on one observed source URL. Different pages
  // with coincident names do not pool their CA support.
  const support = new Map<string, Set<string>>();
  for (const state of confirmed) {
    const url = publicUrl(state.resolution!.meme!.source_url).href;
    const casForSource = support.get(url) ?? new Set<string>();
    for (const ca of state.candidate.coin_cas) casForSource.add(ca);
    support.set(url, casForSource);
  }
  const shared = confirmed.filter(state => requested.every(ca => support.get(publicUrl(state.resolution!.meme!.source_url).href)?.has(ca)));
  if (!shared.length) blockers.add('No independently verified source URL is supported by every supplied CA through a direct listing or explicit one-hop reference.');
  if (blockers.size) {
    for (const state of states.values()) for (const reason of state.candidate.reasons) {
      if (state.candidate.status !== 'confirmed') notes.add(`${state.candidate.url}: ${reason}`);
    }
    return review();
  }
  const chosen = shared.sort((a, b) => config.identity.source_hierarchy.indexOf(a.resolution!.meme!.source_tier) -
    config.identity.source_hierarchy.indexOf(b.resolution!.meme!.source_tier) ||
    a.candidate.url.localeCompare(b.candidate.url))[0]!;
  notes.add('All supplied CAs support the chosen source URL within this bounded discovery. This is not an exhaustive internet search or proof of historical originality.');
  // Do not combine endorsements from rejected, partial or alternative candidates.
  return { resolution: { ...chosen.resolution!, reasons: sorted(chosen.resolution!.reasons) }, candidates: output(), notes: sorted(notes) };
}
