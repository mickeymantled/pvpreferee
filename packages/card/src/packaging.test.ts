import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { nodeFileTrace } from '@vercel/nft';
import ts from 'typescript';
import { expect, it } from 'vitest';
import encoded from '../assets/fonts.json';

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

it('traces embedded fonts and the installed native renderer through the server export', async () => {
  const result = await trace(['node', 'import']);
  expect(result.fileList.has('packages/card/src/index.ts')).toBe(true);
  expect(result.fileList.has('packages/card/assets/fonts.json')).toBe(true);
  expect([...result.fileList].some(path => path.endsWith('.node') && path.includes('resvg'))).toBe(true);
  expect(result.fileList.has('packages/card/src/browser.ts')).toBe(false);
  // resvg's optional binaries for other OS/architectures need not be installed here.
  const ownErrors = [...result.warnings].filter(warning =>
    warning.message.includes('packages/card/') && !warning.message.includes('node_modules/'));
  expect(ownErrors).toEqual([]);
}, 15_000);

it('the browser conditional export does not pull in renderer, font or filesystem code', async () => {
  const result = await trace(['browser', 'import']);
  expect(result.fileList.has('packages/card/src/browser.ts')).toBe(true);
  expect([...result.fileList].filter(path => /satori|resvg|opentype|fonts\.json/.test(path))).toEqual([]);
  expect(result.fileList.has('packages/card/src/index.ts')).toBe(false);
  expect([...result.warnings]).toEqual([]);
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
