import type { Ruling } from '@pvp/shared';
import satori, { type SatoriNode } from 'satori';
import { createDocument, CARD_HEIGHT, CARD_WIDTH } from './document';
import { loadFonts } from './fonts';

/** Internal seam for structural snapshots; only the PNG function is a package export. */
export async function renderSvg(ruling: Ruling, onNodeDetected?: (node: SatoriNode) => void): Promise<string> {
  const fonts = await loadFonts();
  const document = createDocument(ruling, fonts);
  return satori(document.element, {
    width: CARD_WIDTH, height: CARD_HEIGHT, fonts: fonts.fonts,
    embedFont: true, pointScaleFactor: 1,
    onNodeDetected,
    onStyleError(error) { throw error; },
    // No loadAdditionalAsset callback: unsupported glyphs are replaced before layout.
  });
}
