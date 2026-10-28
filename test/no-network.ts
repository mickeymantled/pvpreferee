import { beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
// Default tests must inject fixture transports; live integration requires explicit opt-in.
beforeEach(() => {
  if (process.env.RUN_INTEGRATION !== '1') {
    const deny = (): never => { throw new Error('Network disabled in default tests; inject a fixture transport.'); };
    vi.stubGlobal('fetch', deny);
    vi.spyOn(http, 'request').mockImplementation(deny);
    vi.spyOn(http, 'get').mockImplementation(deny);
    vi.spyOn(https, 'request').mockImplementation(deny);
    vi.spyOn(https, 'get').mockImplementation(deny);
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(deny);
  }
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
