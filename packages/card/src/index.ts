import type { Ruling } from '@pvp/shared';
import { renderAsync } from '@resvg/resvg-js';
import { renderSvg } from './svg';

/** Node.js only. Deterministic 1200x675 PNG, with no remote assets or system fonts. */
export async function renderRulingCard(ruling: Ruling): Promise<Buffer> {
  const svg = await renderSvg(ruling);
  const image = await renderAsync(svg, {
    font: { loadSystemFonts: false },
    imageRendering: 0, // optimizeQuality: preserve normal image scaling, never optimizeSpeed.
    fitTo: { mode: 'original' },
  });
  return image.asPng();
}
