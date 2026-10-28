import { describe, expect, it, vi } from 'vitest';
import { createPublicTransport, isPublicAddress, publicUrl, type ExchangeRequest } from '../src/index.js';
import { response } from './helpers.js';

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];

describe('public-only source transport with synthetic DNS and response fixtures', () => {
  it.each([
    'http://localhost/', 'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/',
    'http://10.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://192.168.0.1/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fc00::1]/',
    'http://[2001:db8::1]/', 'http://100.64.0.1/', 'http://224.0.0.1/',
    'file:///etc/passwd', 'ftp://example.com/a', 'https://name:password@example.com/',
    'https://example.com:444/', 'https://service.internal/', 'https://example.com./',
  ])('rejects unsafe URL %s before dispatch', async url => {
    const exchange = vi.fn(async ({ url }: ExchangeRequest) => response(url.href, 'synthetic'));
    await expect(createPublicTransport({ lookup: publicDns, exchange }).get(url)).rejects.toThrow();
    expect(exchange).not.toHaveBeenCalled();
  });

  it('rejects private, mixed and empty DNS answers, including IPv6 translation ranges', async () => {
    for (const addresses of [[], [{ address: '10.0.0.2', family: 4 }],
      [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }],
      [{ address: '64:ff9b::a00:1', family: 6 }], [{ address: '2002:7f00:1::', family: 6 }]]) {
      const exchange = vi.fn(async ({ url }: ExchangeRequest) => response(url.href, 'synthetic'));
      await expect(createPublicTransport({ lookup: async () => addresses, exchange }).get('https://public.example.com/')).rejects.toThrow(/non-public/);
      expect(exchange).not.toHaveBeenCalled();
    }
  });

  it('passes a validated, pinned address and original hostname to the socket boundary', async () => {
    const lookup = vi.fn(publicDns);
    const exchange = vi.fn(async (request: ExchangeRequest) => {
      expect(request.address).toEqual({ address: '93.184.216.34', family: 4 });
      expect(request.url.hostname).toBe('public.example.com');
      return response(request.url.href, 'synthetic');
    });
    await createPublicTransport({ lookup, exchange }).get('https://public.example.com/');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicAddress('not-an-ip')).toBe(false);
  });

  it('revalidates redirects and rejects a redirect into private DNS', async () => {
    const exchange = vi.fn(async ({ url }: ExchangeRequest) => ({ ...response(url.href, '', 'text/html', 302), headers: { location: 'https://internal.example.com/secret' } }));
    const lookup = vi.fn(async (host: string) => [{ address: host === 'internal.example.com' ? '192.168.1.1' : '93.184.216.34', family: 4 }]);
    await expect(createPublicTransport({ lookup, exchange }).get('https://public.example.com/')).rejects.toThrow(/non-public/);
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('strips credentials across origins and follows relative redirects', async () => {
    const exchange = vi.fn(async ({ url, headers }: ExchangeRequest) => {
      if (url.hostname === 'a.example.com') return { ...response(url.href, '', 'text/html', 302), headers: { location: 'https://b.example.com/step' } };
      expect(headers).toEqual({});
      if (url.pathname === '/step') return { ...response(url.href, '', 'text/html', 307), headers: { location: '/final' } };
      return response(url.href, 'synthetic');
    });
    const result = await createPublicTransport({ lookup: publicDns, exchange }).get('https://a.example.com/', { headers: { Authorization: 'synthetic-token', Cookie: 'synthetic' } });
    expect(result.url).toBe('https://b.example.com/final');
    expect(exchange).toHaveBeenCalledTimes(3);
  });

  it('blocks loops, downgrade, redirect limits and redirects on authenticated API calls', async () => {
    for (const location of ['/', 'http://a.example.com/insecure', 'https://b.example.com/']) {
      const exchange = async ({ url }: ExchangeRequest) => ({ ...response(url.href, '', 'text/html', 302), headers: { location } });
      await expect(createPublicTransport({ lookup: publicDns, exchange, maxRedirects: 1 }).get('https://a.example.com/')).rejects.toThrow(/redirect|downgrade/);
      await expect(createPublicTransport({ lookup: publicDns, exchange }).get('https://a.example.com/', { allowRedirects: false })).rejects.toThrow(/redirect/);
    }
  });

  it('uses an absolute deadline for DNS and response waits', async () => {
    const exchange = vi.fn(async (_request: ExchangeRequest) => new Promise<never>(() => {}));
    await expect(createPublicTransport({ timeoutMs: 10, lookup: async () => new Promise(() => {}), exchange }).get('https://a.example.com/')).rejects.toThrow(/deadline/);
    expect(exchange).not.toHaveBeenCalled();
    await expect(createPublicTransport({ timeoutMs: 10, lookup: publicDns, exchange }).get('https://a.example.com/')).rejects.toThrow(/deadline/);
    expect(exchange.mock.calls[0]?.[0].signal.aborted).toBe(true);
  });

  it('enforces response byte limits, successful HTTP status, and identity encoding', async () => {
    for (const output of [response('https://a.example.com/', '123456'), response('https://a.example.com/', '', 'text/html', 429),
      { ...response('https://a.example.com/', ''), headers: { 'content-encoding': 'gzip' } }]) {
      await expect(createPublicTransport({ maxBytes: 5, lookup: publicDns, exchange: async () => output }).get('https://a.example.com/')).rejects.toThrow();
    }
    expect(() => publicUrl('/relative')).toThrow();
    expect(() => createPublicTransport({ timeoutMs: 0 })).toThrow();
  });
});
