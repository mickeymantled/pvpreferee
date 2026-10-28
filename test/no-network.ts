import { beforeEach, afterEach, vi } from 'vitest';
// Default tests must inject fixture transports; live integration requires explicit opt-in.
beforeEach(() => {
  if (process.env.RUN_INTEGRATION !== '1') vi.stubGlobal('fetch', () => { throw new Error('Network disabled in default tests; inject a fixture transport.'); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
