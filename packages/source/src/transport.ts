import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export class SourceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'SourceError'; }
}
export interface TransportResponse {
  url: string;
  status: number;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
}
export interface FetchOptions { headers?: Record<string, string>; allowRedirects?: boolean }
/** Inject only trusted server-side implementations; fixture transports never access the network. */
export interface SourceTransport { get(url: string, options?: FetchOptions): Promise<TransportResponse> }
export interface PublicAddress { address: string; family: number }
export interface ExchangeRequest {
  url: URL; address: PublicAddress; headers: Record<string, string>; signal: AbortSignal; maxBytes: number;
}
export interface PublicTransportOptions {
  timeoutMs?: number; maxBytes?: number; maxRedirects?: number;
  lookup?: (hostname: string) => Promise<PublicAddress[]>;
  /** Test seam below the URL/DNS/redirect policy. Production uses pinned Node HTTP sockets. */
  exchange?: (request: ExchangeRequest) => Promise<TransportResponse>;
}
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  // Mapped, translated, documentation, link-local, multicast and reserved ranges are denied.
  if (parsed.range() !== 'unicast') return false;
  return parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3);
}
/** Syntactic check only. createPublicTransport additionally checks and pins DNS on every hop. */
export function publicUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new SourceError('UNSAFE_URL', 'An absolute public HTTP(S) URL is required.'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      hostname.endsWith('.') || !hostname.includes('.') && !isIP(hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(hostname) ||
      isIP(hostname) && !isPublicAddress(hostname)) {
    throw new SourceError('UNSAFE_URL', 'Only public HTTP(S) URLs on their standard ports are allowed.');
  }
  url.hash = '';
  return url;
}

async function nodeExchange(input: ExchangeRequest): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const request = (input.url.protocol === 'https:' ? httpsRequest : httpRequest)(input.url, {
      method: 'GET', agent: false, signal: input.signal,
      headers: { 'user-agent': 'PvPReferee/0.1 source-resolver', 'accept-encoding': 'identity', ...input.headers },
      // Preserve hostname/SNI and certificate verification while preventing a second DNS lookup.
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [input.address])
        : callback(null, input.address.address, input.address.family),
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('error', reject);
      response.on('aborted', () => reject(new SourceError('NETWORK', 'Source response was interrupted.')));
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > input.maxBytes) {
          request.destroy(new SourceError('TOO_LARGE', 'Source exceeds the configured response byte limit.'));
        } else chunks.push(chunk);
      });
      response.on('end', () => resolve({
        url: input.url.href, status: response.statusCode ?? 0,
        headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])),
        body: Buffer.concat(chunks),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

export function createPublicTransport(options: PublicTransportOptions = {}): SourceTransport {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 4;
  if (![timeoutMs, maxBytes].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new SourceError('CONFIG', 'Transport limits must be positive integers (redirects may be zero).');
  }
  const dns = options.lookup ?? (hostname => lookup(hostname, { all: true, verbatim: true }));
  const exchange = options.exchange ?? nodeExchange;
  return {
    async get(value, fetchOptions = {}) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new SourceError('TIMEOUT', 'Source fetch exceeded its deadline, including DNS and redirects.'));
        }, timeoutMs);
      });
      const run = async (): Promise<TransportResponse> => {
        let url = publicUrl(value);
        let headers = { ...fetchOptions.headers };
        const visited = new Set<string>();
        for (let hop = 0; hop <= maxRedirects; hop++) {
          if (controller.signal.aborted) throw new SourceError('TIMEOUT', 'Source fetch expired.');
          if (visited.has(url.href)) throw new SourceError('REDIRECT', 'Source redirect loop.');
          visited.add(url.href);
          const hostname = url.hostname.replace(/^\[|\]$/g, '');
          const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await dns(hostname);
          if (!addresses.length || addresses.some(a => !isPublicAddress(a.address) || a.family !== isIP(a.address))) {
            throw new SourceError('UNSAFE_ADDRESS', 'Source DNS includes a non-public address.');
          }
          if (controller.signal.aborted) throw new SourceError('TIMEOUT', 'Source DNS exceeded its deadline.');
          const response = await exchange({ url, address: addresses[0]!, headers, signal: controller.signal, maxBytes });
          if (response.body.byteLength > maxBytes) throw new SourceError('TOO_LARGE', 'Source exceeds the response byte limit.');
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            if (fetchOptions.allowRedirects === false || hop === maxRedirects || !response.headers.location) {
              throw new SourceError('REDIRECT', 'Source redirect is disallowed, missing, or exceeds the hop limit.');
            }
            const next = publicUrl(new URL(response.headers.location, url).href);
            if (url.protocol === 'https:' && next.protocol !== 'https:') throw new SourceError('REDIRECT', 'HTTPS downgrade denied.');
            if (next.origin !== url.origin) headers = {};
            url = next;
            continue;
          }
          if (response.status < 200 || response.status >= 300) {
            throw new SourceError('HTTP', `Source returned HTTP ${response.status}; check access, quota, or availability.`);
          }
          if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
            throw new SourceError('ENCODING', 'Source ignored identity encoding; compressed responses are unsupported.');
          }
          return { ...response, url: url.href };
        }
        throw new SourceError('REDIRECT', 'Source redirect limit exceeded.');
      };
      try { return await Promise.race([run(), timeout]); }
      finally { clearTimeout(timer); controller.abort(); }
    },
  };
}

export function responseText(response: TransportResponse, kind: 'html' | 'json'): string {
  const contentType = response.headers['content-type'] ?? '';
  if (kind === 'html' ? !/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType) : !/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType)) {
    throw new SourceError('CONTENT_TYPE', `Expected a ${kind.toUpperCase()} source response.`);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(response.body);
}
