import { parse, type Font as Metrics } from 'opentype.js';
import type { Font } from 'satori';
import encoded from '../assets/fonts.json';

export interface CardFonts { fonts: Font[]; regular: Metrics; semibold: Metrics }
let cached: Promise<CardFonts> | undefined;

/** Static JSON imports survive Next bundling and tracing; no runtime asset paths. */
export function loadFonts(): Promise<CardFonts> {
  cached ??= Promise.resolve().then((): CardFonts => {
    const regular = Buffer.from(encoded.regular, 'base64');
    const semibold = Buffer.from(encoded.semibold, 'base64');
    return {
      fonts: [
        { name: 'Inter', data: regular, weight: 400, style: 'normal' },
        { name: 'Inter', data: semibold, weight: 600, style: 'normal' },
      ],
      regular: parse(Uint8Array.from(regular).buffer),
      semibold: parse(Uint8Array.from(semibold).buffer),
    };
  });
  return cached;
}

/** Sum unkerned advances, with a small margin for shaping and glyph overhang. */
export function textWidth(text: string, size: number, font: Metrics): number {
  return font.getAdvanceWidth(text, size, { kerning: false }) * 1.04 + 2;
}

export function fitText(text: string, width: number, size: number, font: Metrics): string {
  if (textWidth(text, size, font) <= width) return text;
  const points = Array.from(text);
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (textWidth(points.slice(0, middle).join('') + '...', size, font) <= width) low = middle;
    else high = middle - 1;
  }
  return points.slice(0, low).join('').trimEnd() + '...';
}
