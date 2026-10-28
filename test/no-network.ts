import { beforeEach, afterEach, vi } from 'vitest';
import net from 'node:net';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
// Default tests must inject fixture transports; live integration requires explicit opt-in.
beforeEach(() => {
  if (process.env.RUN_INTEGRATION !== '1') {
    const deny = (): never => { throw new Error('Network disabled in default tests; inject a fixture transport.'); };
    vi.stubGlobal('fetch', deny);
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(deny);
    vi.spyOn(dns, 'lookup').mockImplementation(deny);
    vi.spyOn(dnsPromises, 'lookup').mockImplementation(deny);
  }
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
