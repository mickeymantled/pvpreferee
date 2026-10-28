import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { request } from 'node:https';
import { beforeEach, expect, it, vi } from 'vitest';
import { createPublicTransport } from '../src/index.js';

const fixture = vi.hoisted(() => ({ body: 'synthetic response' }));

// Exercise the production Node adapter without opening a socket or doing ambient DNS.
vi.mock('node:https', async () => {
  const { EventEmitter } = await import('node:events');
  return { request: vi.fn((_url: URL, options: RequestOptions, onResponse: (response: IncomingMessage) => void) => {
    const req = new EventEmitter() as ClientRequest;
    req.destroy = vi.fn((error?: Error) => { if (error) req.emit('error', error); return req; });
    req.end = vi.fn(() => {
      queueMicrotask(() => {
        if (options.signal?.aborted) { req.emit('error', new Error('aborted')); return; }
        const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'text/html' } }) as IncomingMessage;
        onResponse(res);
        res.emit('data', Buffer.from(fixture.body));
        res.emit('end');
      });
      return req;
    }) as ClientRequest['end'];
    return req;
  }) };
});

beforeEach(() => { vi.mocked(request).mockClear(); fixture.body = 'synthetic response'; });

it('pins a public DNS result for both Node lookup callback modes and preserves TLS hostname', async () => {
  const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
  const output = await createPublicTransport({ lookup }).get('https://source.example.com/path');
  expect(new TextDecoder().decode(output.body)).toBe('synthetic response');
  const calls = vi.mocked(request).mock.calls as unknown as [URL, RequestOptions, unknown][];
  const [url, options] = calls[0]!;
  expect(url.hostname).toBe('source.example.com');
  expect(options.agent).toBe(false);
  const one = vi.fn();
  const all = vi.fn();
  options.lookup!('source.example.com', { all: false }, one);
  options.lookup!('source.example.com', { all: true }, all);
  expect(one).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  expect(all).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  expect(lookup).toHaveBeenCalledTimes(1);
});

it('destroys a production-adapter response as soon as its streamed body exceeds budget', async () => {
  fixture.body = 'synthetic oversized response';
  await expect(createPublicTransport({ maxBytes: 4, lookup: async () => [{ address: '93.184.216.34', family: 4 }] })
    .get('https://source.example.com/path')).rejects.toThrow(/byte limit/);
  const req = vi.mocked(request).mock.results[0]?.value as ClientRequest;
  expect(req.destroy).toHaveBeenCalled();
});
