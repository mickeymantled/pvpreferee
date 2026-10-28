import { describe, expect, it, vi } from 'vitest';
import { RateLimitError } from '../../../../server/rate-limit';
const mocks = vi.hoisted(() => ({ enforce: vi.fn(), response: vi.fn(), find: vi.fn() }));
vi.mock('../../../../server/rate-limit', async original => ({ ...await original<typeof import('../../../../server/rate-limit')>(), enforceRateLimit: mocks.enforce }));
vi.mock('../../../../server/services', () => ({ findStoredRuling: mocks.find }));
vi.mock('../../../../server/card', () => ({ cardResponse: mocks.response }));
import { GET } from './route';
describe('card route budget', () => {
  it.each([429, 503] as const)('returns %s with no render or DB access when protection rejects', async status => {
    mocks.enforce.mockRejectedValue(new RateLimitError(status, 60));
    const result = await GET(new Request('https://pvp.example/api/card/test'), { params: Promise.resolve({ slug: 'test' }) });
    expect(result.status).toBe(status);
    expect(result.headers.get('Retry-After')).toBe('60');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.response).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
  });
});
