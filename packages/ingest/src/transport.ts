import type { HttpRequest, HttpResponse, Transport } from './contracts';
import { IngestError, object } from './common';

export class FetchTransport implements Transport {
  constructor(private readonly timeoutMs = 10_000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new IngestError('INVALID_INPUT', 'timeoutMs must be positive');
  }
  async request(request: HttpRequest): Promise<HttpResponse> {
    try {
      const response = await fetch(request.url, {
        method: request.method, headers: request.headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(request.timeoutMs ?? this.timeoutMs), redirect: 'error',
      });
      // Never include the endpoint, API key, response body or fetch error in diagnostics.
      if (!response.ok) return { status: response.status, body: null };
      return { status: response.status, body: await response.json() };
    } catch { throw new IngestError('PROVIDER_ERROR', 'Provider request failed, timed out, or returned invalid JSON'); }
  }
}
export async function requestJson(transport: Transport, request: HttpRequest, label: string): Promise<unknown> {
  const response = await transport.request(request);
  if (response.status < 200 || response.status >= 300) throw new IngestError('PROVIDER_ERROR', `${label}: HTTP ${response.status}; check credentials, quota and availability`);
  return response.body;
}
export class JsonRpcClient {
  constructor(private readonly url: string, private readonly transport: Transport = new FetchTransport()) {}
  async call(method: string, params: HttpRequest['body']): Promise<unknown> {
    const body = object(await requestJson(this.transport, { url: this.url, method: 'POST', headers: { 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: 'pvp-ingest', method, params: params ?? null } }, `RPC ${method}`), 'RPC response');
    if (body.error != null) throw new IngestError('PROVIDER_ERROR', `RPC ${method} failed; check API access and provider status`);
    if (!('result' in body)) throw new IngestError('INVALID_RESPONSE', `RPC ${method}: missing result`);
    return body.result;
  }
}
