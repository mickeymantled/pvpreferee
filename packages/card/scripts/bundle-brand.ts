import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Encoding only: keep the supplied JPEG bytes intact, including its black background.
// The renderer imports the generated JSON; it never reads this source file at runtime.
const original = await readFile(new URL('../assets/ref.jpg', import.meta.url));
const sha256 = createHash('sha256').update(original).digest('hex');
if (sha256 !== '49bca3cde17a8bc4d5c94ddfec127dc4e7063db27dad5138b946952d21327fb1') {
  throw new Error('@pvp/card: brand asset differs from the approved original ref.jpg.');
}
await writeFile(new URL('../assets/brand.json', import.meta.url), JSON.stringify({
  mimeType: 'image/jpeg', width: 1408, height: 1408, sha256, base64: original.toString('base64'),
}) + '\n');
