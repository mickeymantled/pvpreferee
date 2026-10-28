import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { hashImage, hashImageFromUrl, imageDistance } from '../src/image.js';
import { jsonFixture, response } from './helpers.js';

async function syntheticRaster(): Promise<Buffer> {
  const scene = await jsonFixture('image-shapes.json') as { width: number; height: number; background: number[];
    rectangles: { x: number; y: number; width: number; height: number; color: number[] }[] };
  const pixels = Buffer.alloc(scene.width * scene.height * 3);
  for (let y = 0; y < scene.height; y++) for (let x = 0; x < scene.width; x++) {
    const rectangle = scene.rectangles.find(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
    const color = rectangle?.color ?? scene.background;
    for (let channel = 0; channel < 3; channel++) pixels[(y * scene.width + x) * 3 + channel] = color[channel]!;
  }
  return sharp(pixels, { raw: { width: scene.width, height: scene.height, channels: 3 } }).png().toBuffer();
}

describe('64-bit perceptual image hash', () => {
  it('compares validated hashes with exact Hamming distance', () => {
    expect(imageDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(imageDistance('0123456789abcdef', '0123456789ABCDEF')).toBe(0);
    expect(imageDistance('0000000000000000', '0000000000000001')).toBe(1);
    expect(() => imageDistance('z'.repeat(16), '0'.repeat(16))).toThrow();
    expect(() => imageDistance('1234', '0'.repeat(16))).toThrow();
  });

  it('is stable for synthetic recolors, resizes, compression and a small symmetric crop', async () => {
    const original = await syntheticRaster();
    const hash = await hashImage(original);
    expect(hash).toMatch(/^[a-f\d]{16}$/);
    for (const transformed of [
      await sharp(original).modulate({ hue: 120, saturation: 0.4 }).png().toBuffer(),
      await sharp(original).resize(256, 256).jpeg({ quality: 70 }).toBuffer(),
      await sharp(original).extract({ left: 2, top: 2, width: 124, height: 124 }).png().toBuffer(),
    ]) expect(imageDistance(hash, await hashImage(transformed))).toBeLessThanOrEqual(10);
  });

  it('documents failures: heavy crops can differ, and flat colors collide', async () => {
    const original = await syntheticRaster();
    const crop = await sharp(original).extract({ left: 68, top: 16, width: 48, height: 44 }).png().toBuffer();
    expect(imageDistance(await hashImage(original), await hashImage(crop))).toBeGreaterThan(10);
    const solid = (background: string) => sharp({ create: { width: 64, height: 64, channels: 3, background } }).png().toBuffer();
    expect(await hashImage(await solid('#ff0000'))).toBe(await hashImage(await solid('#0000ff')));
  });

  it('hashes URL bytes through the supplied transport, rejecting unsafe URLs and non-raster content', async () => {
    const bytes = await syntheticRaster();
    const get = vi.fn(async (url: string) => ({ ...response(url, '', 'image/png'), body: bytes }));
    expect(await hashImageFromUrl('https://images.example.com/test.png', { transport: { get } })).toBe(await hashImage(bytes));
    await expect(hashImageFromUrl('http://127.0.0.1/image', { transport: { get } })).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(1);
    await expect(hashImageFromUrl('https://images.example.com/test.svg', { transport: { get: async url => response(url, '<svg/>', 'image/svg+xml') } })).rejects.toThrow();
    await expect(hashImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'))).rejects.toThrow(/raster/);
  });

  it('rejects malformed input and byte/pixel budgets', async () => {
    await expect(hashImage(new Uint8Array())).rejects.toThrow();
    await expect(hashImage(new Uint8Array(8 * 1024 * 1024 + 1))).rejects.toThrow();
    await expect(hashImage(Buffer.from('not an image'))).rejects.toThrow();
  });
});
