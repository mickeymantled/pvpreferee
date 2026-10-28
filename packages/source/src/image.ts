import { createPublicTransport, publicUrl, SourceError, type SourceTransport } from './transport.js';

/** Hamming distance of two 64-bit hexadecimal hashes. Does not load native sharp. */
export function imageDistance(a: string, b: string): number {
  if (!/^[a-f\d]{16}$/i.test(a) || !/^[a-f\d]{16}$/i.test(b)) throw new SourceError('IMAGE_HASH', 'Image hashes must contain exactly 16 hexadecimal digits.');
  let xor = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let distance = 0;
  while (xor) { xor &= xor - 1n; distance++; }
  return distance;
}

/** 32x32 luminance DCT pHash, low-frequency 8x8 coefficients, DC bit fixed to zero. */
export async function hashImage(bytes: Uint8Array): Promise<string> {
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new SourceError('IMAGE_SIZE', 'Image must contain 1 byte to 8 MiB.');
  const header = Buffer.from(bytes.subarray(0, 32));
  const rasterSignature = header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
    header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    /^GIF8[79]a/.test(header.toString('ascii')) ||
    header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP' ||
    ['49492a00', '4d4d002a', '49492b00', '4d4d002b'].includes(header.subarray(0, 4).toString('hex')) ||
    header.toString('ascii', 4, 8) === 'ftyp' && /avif|avis|heic|heix|hevc|hevx|mif1|msf1/.test(header.toString('ascii', 8));
  if (!rasterSignature) throw new SourceError('IMAGE_FORMAT', 'Only recognized raster image signatures are supported.');
  // Lazy native import: rules/pipeline may import imageDistance without loading sharp.
  const { default: sharp } = await import('sharp');
  // Raster-only avoids SVG external-resource handling; one frame, bounded pixels and CPU time.
  const decoder = sharp(bytes, { limitInputPixels: 25_000_000, pages: 1, failOn: 'warning' }).timeout({ seconds: 5 });
  const metadata = await decoder.metadata();
  if (!metadata.format || !['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff'].includes(metadata.format)) {
    throw new SourceError('IMAGE_FORMAT', 'Only raster images are supported.');
  }
  const pixels = await decoder.rotate().flatten({ background: '#ffffff' }).resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer();
  const coefficients: number[] = [];
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    let sum = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      sum += pixels[y * 32 + x]! * Math.cos((2 * x + 1) * u * Math.PI / 64) * Math.cos((2 * y + 1) * v * Math.PI / 64);
    }
    coefficients.push(Math.abs(sum) < 1e-7 ? 0 : sum);
  }
  const ordered = coefficients.slice(1).sort((a, b) => a - b);
  const median = ordered[31]!;
  let hash = 0n;
  for (let i = 0; i < 64; i++) hash = (hash << 1n) | (i > 0 && coefficients[i]! > median ? 1n : 0n);
  return hash.toString(16).padStart(16, '0');
}

export interface HashImageUrlOptions { transport?: SourceTransport }
export async function hashImageFromUrl(url: string, options: HashImageUrlOptions = {}): Promise<string> {
  const response = await (options.transport ?? createPublicTransport()).get(publicUrl(url).href);
  if (!/^image\/(?:png|jpeg|webp|gif|avif|heif|heic|tiff)(?:;|$)/i.test(response.headers['content-type'] ?? '')) {
    throw new SourceError('IMAGE_FORMAT', 'Image URL must return a supported raster content type.');
  }
  return hashImage(response.body);
}
