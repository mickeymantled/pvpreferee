import { describe, expect, it } from 'vitest';
import { loadRulebook } from '@pvp/config';
import { rule } from '@pvp/rules';
import { fixtures } from '@pvp/rules/fixtures';
import type { Ruling } from '@pvp/shared';
import type { SatoriNode } from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { renderRulingCard } from './index';
import { renderRulingCard as browserRender } from './browser';
import { CARD_HEIGHT, CARD_WIDTH, colors, createDocument } from './document';
import { loadFonts, textWidth } from './fonts';
import { renderSvg } from './svg';
import { scenario } from '../test/scenarios';
import brand from '../assets/brand.json';

function expectPng(png: Buffer): void {
  expect(Buffer.isBuffer(png)).toBe(true);
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.toString('ascii', 12, 16)).toBe('IHDR');
  expect(png.readUInt32BE(16)).toBe(CARD_WIDTH);
  expect(png.readUInt32BE(20)).toBe(CARD_HEIGHT);
  expect(png.length).toBeGreaterThan(5_000);
}

async function inspect(ruling: Ruling) {
  const fonts = await loadFonts();
  const document = createDocument(ruling, fonts);
  const nodes: SatoriNode[] = [];
  const svg = await renderSvg(ruling, node => nodes.push(node));
  expect(nodes.length).toBeGreaterThan(document.lines.length);
  for (const node of nodes) {
    expect(node.left).toBeGreaterThanOrEqual(0);
    expect(node.top).toBeGreaterThanOrEqual(0);
    expect(node.left + node.width).toBeLessThanOrEqual(CARD_WIDTH + 1);
    expect(node.top + node.height).toBeLessThanOrEqual(CARD_HEIGHT + 1);
  }
  for (const line of document.lines) {
    const metrics = line.weight === 600 ? fonts.semibold : fonts.regular;
    expect(textWidth(line.text, line.size, metrics), line.id).toBeLessThanOrEqual(line.width);
    expect(line.height, line.id).toBeGreaterThanOrEqual(line.size * 1.15);
  }
  expect(svg).toContain('width="1200" height="675"');
  expect(svg).not.toMatch(/<text\b/); // Font outlines only, no renderer/system fallback.
  const images = svg.match(/<image\b[^>]*>/g) ?? [];
  expect(images).toHaveLength(1);
  expect(images[0]).toContain(`href="data:${brand.mimeType};base64,${brand.base64}"`);
  expect(images[0]).not.toMatch(/image-rendering="(?:optimizeSpeed|pixelated|crisp-edges)"/);
  const logo = nodes.find(node => node.props['data-card-id'] === 'brand-logo')!;
  const badge = nodes.find(node => node.props['data-card-id'] === 'brand-mark')!;
  const brandText = nodes.find(node => node.props['data-card-id'] === 'brand')!;
  const headerLine = nodes.find(node => node.props['data-card-id'] === 'header-line')!;
  expect([logo.left, logo.top, logo.width, logo.height]).toEqual([48, 20, 58, 58]);
  expect([badge.left, badge.top, badge.width, badge.height]).toEqual([48, 20, 58, 58]);
  expect(logo.props.style).toMatchObject({ objectFit: 'contain' });
  expect(badge.props.style).toMatchObject({ backgroundColor: '#000000' });
  expect(logo.width / logo.height).toBe(brand.width / brand.height);
  expect(brandText.left).toBeGreaterThan(logo.left + logo.width);
  expect(headerLine.top).toBeGreaterThan(logo.top + logo.height);
  const rendered = new Resvg(svg, { font: { loadSystemFonts: false } });
  expect(rendered.imagesToResolve()).toEqual([]);
  const bounds = rendered.getBBox()!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(CARD_WIDTH + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(CARD_HEIGHT + 1);
  return {
    document, svg,
    // Compact, reviewable Satori geometry + visible text; no platform-specific PNG hashes.
    snapshot: nodes.filter(node => node.textContent || ['brand-mark', 'brand-logo'].includes(String(node.props['data-card-id']))).map(node => ({
      id: node.props['data-card-id'], text: node.textContent,
      box: [node.left, node.top, node.width, node.height].map(value => Math.round(value * 100) / 100),
      ...(node.props['data-card-id'] === 'brand-logo' ? { asset: brand.sha256 } : {}),
    })),
  };
}

describe('public rule fixtures', () => {
  it('covers all ten exported fixture variants', () => {
    expect(fixtures.map(fixture => fixture.name)).toEqual([
      'robotaxi', 'robotaxi_tsla', 'invisible_cat', 'kimchi', 'kimchi_qr', 'kiongozi',
      'tilcayo', 'tilcayo_same_meme', 'solcat', 'cz_bnb',
    ]);
  });
  for (const fixture of fixtures) {
    it(`renders and snapshots ${fixture.name}`, async () => {
      const ruling = rule(fixture.coins, fixture.meme, loadRulebook().config);
      expect(ruling.status).toBe(fixture.expected.status);
      expect(ruling.winner_ca).toBe(fixture.expected.winner_ca);
      const before = structuredClone(ruling);
      const { document, snapshot } = await inspect(ruling);
      expect(snapshot.length).toBe(document.lines.length + 2);
      expect(snapshot).toMatchSnapshot();
      const winner = document.lines.find(line => line.id === 'winner-ca');
      expect(winner?.text ?? null).toBe(ruling.winner_ca);
      expect(document.content.rows).toHaveLength(ruling.coin_cas.length - Number(ruling.winner_ca !== null));
      for (const row of document.content.rows) {
        const eliminatedBy = fixture.expected.eliminated_by[row.ca];
        if (eliminatedBy !== null) expect(row.detail).toMatch(new RegExp(`^R${eliminatedBy} `));
        expect(row.state).toBe(eliminatedBy !== null ? 'FAIL' : 'N/A');
      }
      expectPng(await renderRulingCard(ruling));
      expect(ruling).toEqual(before);
    });
  }
});

describe('capacity and status cards', () => {
  for (const status of ['resolved', 'unresolved', 'separate_memes', 'no_winner'] as const) {
    it(`fits ten coins for ${status} without clipping or losing candidates`, async () => {
      const ruling = scenario(status);
      expect(ruling.status).toBe(status);
      const { document, snapshot } = await inspect(ruling);
      expect(snapshot).toMatchSnapshot();
      expect(document.content.rows).toHaveLength(status === 'resolved' ? 9 : 10);
      const visibleAddresses = document.lines.filter(line => /^row-\d+-ca$/.test(line.id)).map(line => line.text);
      expect(new Set(visibleAddresses).size).toBe(visibleAddresses.length);
      expect(document.lines.some(line => line.id === 'winner-ca')).toBe(status === 'resolved');
      expectPng(await renderRulingCard(ruling));
    });
  }
  it('fits long strings and unsupported glyphs without altering the winner CA', async () => {
    const ruling = scenario('resolved', 10, true);
    const { document, snapshot } = await inspect(ruling);
    expect(snapshot).toMatchSnapshot();
    expect(document.content.hasUnsupportedText).toBe(true);
    expect(document.lines.find(line => line.id === 'winner-ca')?.text).toBe(ruling.winner_ca);
    expect(document.lines.find(line => line.id === 'meme')?.text).toMatch(/\.\.\.$/);
    expect(document.lines.find(line => line.id === 'footer')?.text).toContain('Unsupported glyphs');
    expectPng(await renderRulingCard(ruling));
  });
  it('fits all supported candidate counts, including the six/seven row density switch', async () => {
    for (let count = 2; count <= 10; count++) {
      const { document } = await inspect(scenario('no_winner', count));
      expect(document.content.rows).toHaveLength(count);
    }
  });
});

describe('determinism, safety and server boundary', () => {
  it('renders the original logo with quality image scaling, not speed scaling', async () => {
    const ruling = scenario('resolved');
    const svg = await renderSvg(ruling);
    const quality = new Resvg(svg, { font: { loadSystemFonts: false }, imageRendering: 0 }).render().asPng();
    const speed = new Resvg(svg, { font: { loadSystemFonts: false }, imageRendering: 1 }).render().asPng();
    const png = await renderRulingCard(ruling);
    // Compare rendering modes in this environment, without platform-specific golden hashes.
    expect(png.equals(quality)).toBe(true);
    expect(png.equals(speed)).toBe(false);
  });
  it('renders identical bytes for concurrent repeated requests with no clock or network dependence', async () => {
    const ruling = scenario('resolved');
    const [a, b, c] = await Promise.all([renderRulingCard(ruling), renderRulingCard(ruling), renderRulingCard(ruling)]);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(true);
    // test/no-network.ts rejects fetch, socket connections and DNS for every render above.
  });
  it('does not fetch source/coin images, evidence URLs, or act on flags', async () => {
    const ruling = scenario('resolved');
    const before = await renderRulingCard(ruling);
    ruling.facts.meme.source_image_url = 'http://127.0.0.1:1/private';
    for (const coin of ruling.facts.coins) {
      coin.image_url = 'http://127.0.0.1:1/private';
      coin.flags = { bundled: true, dev_sold: true, top10_pct: 100 };
      coin.evidence = ['http://127.0.0.1:1/private'];
    }
    expect((await renderRulingCard(ruling)).equals(before)).toBe(true);
  });
  it('escapes untrusted markup as font paths', async () => {
    const ruling = scenario('resolved', 2);
    ruling.facts.meme.canonical_name = '<img src="https://bad.invalid" /> & <script>bad()</script>';
    const { svg } = await inspect(ruling);
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('<img');
  });
  it('rejects malformed rulings instead of presenting a misleading verdict', async () => {
    const valid = scenario('resolved', 2);
    const cases = [
      { ...valid, coin_cas: [valid.coin_cas[0]!] },
      { ...valid, coin_cas: [valid.coin_cas[0]!, valid.coin_cas[0]!] },
      { ...valid, winner_ca: null },
      { ...valid, status: 'unresolved' as const },
      { ...valid, grid: [] },
      { ...valid, winner_ca: 'unknown' },
      { ...valid, coin_cas: ['bad\nCA', valid.coin_cas[1]!] },
    ];
    for (const input of cases) await expect(renderRulingCard(input)).rejects.toThrow('@pvp/card:');
  });
  it('provides an actionable browser error without importing a native renderer', async () => {
    await expect(browserRender(scenario('resolved', 2))).rejects.toThrow('server-only');
  });
  it('uses text colors with WCAG AA contrast even at the smallest size', () => {
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
    };
    for (const foreground of [colors.text, colors.muted, colors.green, colors.red, colors.amber]) {
      for (const background of [colors.background, colors.panel, colors.greenPanel]) {
        expect((luminance(foreground) + 0.05) / (luminance(background) + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
