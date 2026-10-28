import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INPUT, MEME, resolution } from '../../test/fixtures';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), protect: vi.fn(), admin: vi.fn(), override: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../server/services', () => ({ webServices: { resolve: mocks.resolve } }));
vi.mock('../../server/security', () => ({ protectRequest: mocks.protect, currentAdmin: mocks.admin }));
vi.mock('../../server/overrides', () => ({ loadOverrideReview: mocks.override }));
vi.mock('../actions', () => ({ beginReview: vi.fn(), issueRuling: vi.fn() }));
vi.mock('../admin/actions', () => ({ saveOverride: vi.fn(), rerunAction: vi.fn(), login: vi.fn(), logout: vi.fn() }));
import ResolvePage from './page';

beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.admin.mockResolvedValue(null);
  mocks.resolve.mockResolvedValue({ ...resolution(), discovery: { candidates: [], notes: [] } });
});
const automatic = { cas: INPUT.cas.join('\n'), version: 'v1' };
async function page(params: Record<string, string> = automatic) {
  return renderToStaticMarkup(await ResolvePage({ searchParams: Promise.resolve(params) }));
}

describe('automatic-origin review route', () => {
  it('researches a CA-only URL under the source rate limit and offers the verified ruling step', async () => {
    const html = await page();
    expect(mocks.protect).toHaveBeenCalledWith('source');
    expect(mocks.resolve).toHaveBeenCalledWith({ ...INPUT, source_url: '' });
    expect(html).toContain('Meme origin.');
    expect(html).toContain(MEME.canonical_name);
    expect(html).toContain('Issue ruling');
    expect(html).toContain('name="source_url" value=""');
    expect(html).not.toContain('Already have an original source link?');
    expect(mocks.override).not.toHaveBeenCalled();
  });
  it('explains unresolved research without rendering a fake canonical record or issue action', async () => {
    mocks.resolve.mockResolvedValue({ meme: null, endorsements: [], needs_review: true, reasons: ['No verified origin.'], discovery: { candidates: [], notes: ['Synthetic provider returned no links.'] } });
    const html = await page();
    expect(html).toContain('Origin not confirmed');
    expect(html).toContain('No verified origin.');
    expect(html).toContain('Retry automatic lookup');
    expect(html).toContain('(Optional)');
    expect(html).not.toContain('Issue ruling');
    expect(html).not.toContain('Canonical fields');
  });
  it('retains explicit-source review URLs and prevents empty-source admin overrides', async () => {
    mocks.admin.mockResolvedValue({ actor: 'synthetic-admin' });
    await page();
    expect(mocks.override).not.toHaveBeenCalled();
    mocks.override.mockResolvedValue({ previous: MEME, fingerprint: 'a'.repeat(64) });
    const html = await page({ ...automatic, source_url: INPUT.source_url });
    expect(html).toContain('Review the source.');
    expect(mocks.override).toHaveBeenCalledWith(INPUT);
  });
  it('sanitizes research failures and never implies a ruling was saved', async () => {
    mocks.resolve.mockRejectedValue(new Error('https://secret:SENSITIVE@db.example'));
    const html = await page();
    expect(html).toContain('Origin lookup is unavailable.');
    expect(html).toContain('No ruling was issued.');
    expect(html).not.toContain('SENSITIVE');
    expect(html).not.toContain('Issue ruling');
  });
});
