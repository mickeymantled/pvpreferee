import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { nodeFileTrace } from '@vercel/nft';
import ts from 'typescript';
import { expect, it } from 'vitest';
import encoded from '../assets/fonts.json';
import brand from '../assets/brand.json';

const base = fileURLToPath(new URL('../../../', import.meta.url));
const entry = fileURLToPath(new URL('../test/entry.ts', import.meta.url));

async function trace(conditions: string[]) {
  return nodeFileTrace([entry], {
    base, conditions,
    // Match the JS Next traces after compiling workspace TypeScript modules.
    async readFile(path) {
      try {
        const source = await readFile(path);
        if (path.endsWith('.ts') && !path.includes('/node_modules/')) {
          return ts.transpileModule(source.toString(), {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
          }).outputText;
        }
        return source;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
  });
}

it('traces embedded fonts, the brand image and native renderer through the server export', async () => {
  const result = await trace(['node', 'import']);
  expect(result.fileList.has('packages/card/src/index.ts')).toBe(true);
  expect(result.fileList.has('packages/card/assets/fonts.json')).toBe(true);
  expect(result.fileList.has('packages/card/assets/brand.json')).toBe(true);
  expect(result.fileList.has('packages/card/assets/ref.jpg')).toBe(false);
  expect([...result.fileList].filter(path => path.startsWith('packages/card/scripts/'))).toEqual([]);
  expect([...result.fileList].some(path => path.endsWith('.node') && path.includes('resvg'))).toBe(true);
  expect(result.fileList.has('packages/card/src/browser.ts')).toBe(false);
  // resvg's optional binaries for other OS/architectures need not be installed here.
  const ownErrors = [...result.warnings].filter(warning =>
    warning.message.includes('packages/card/') && !warning.message.includes('node_modules/'));
  expect(ownErrors).toEqual([]);
}, 15_000);

it('the browser conditional export does not pull in renderer, assets or filesystem code', async () => {
  const result = await trace(['browser', 'import']);
  expect(result.fileList.has('packages/card/src/browser.ts')).toBe(true);
  expect([...result.fileList].filter(path => /satori|resvg|opentype|packages\/card\/assets\//.test(path))).toEqual([]);
  expect(result.fileList.has('packages/card/src/index.ts')).toBe(false);
  expect([...result.warnings]).toEqual([]);
});

it('embedded brand data preserves the approved JPEG bytes and reproducible encoding', async () => {
  const original = await readFile(new URL('../assets/ref.jpg', import.meta.url));
  const hash = '49bca3cde17a8bc4d5c94ddfec127dc4e7063db27dad5138b946952d21327fb1';
  expect(createHash('sha256').update(original).digest('hex')).toBe(hash);
  expect(brand).toEqual({ mimeType: 'image/jpeg', width: 1408, height: 1408, sha256: hash, base64: original.toString('base64') });
  expect(Buffer.from(brand.base64, 'base64').equals(original)).toBe(true);
  expect(await readFile(new URL('../assets/brand.json', import.meta.url), 'utf8')).toBe(JSON.stringify(brand) + '\n');
});

it('embedded font data exactly matches the licensed, pinned original assets', async () => {
  const expected = [
    ['regular', '400', 'e20fa0b4fd2dd26e4d14b3ac3cc922509c3a63fa5e910e90c614544aa042dd45'],
    ['semibold', '600', '6a9cb3a509b4eeaf12b7dda6c4aacac3e85d07f4201bf4dd716e332e692b87bd'],
  ] as const;
  for (const [key, weight, hash] of expected) {
    const original = await readFile(new URL(`../assets/inter-latin-${weight}-normal.woff`, import.meta.url));
    expect(Buffer.from(encoded[key], 'base64').equals(original)).toBe(true);
    expect(createHash('sha256').update(original).digest('hex')).toBe(hash);
  }
});
