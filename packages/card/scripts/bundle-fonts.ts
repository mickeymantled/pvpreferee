import { readFile, writeFile } from 'node:fs/promises';

// Reproducible asset generation only. The renderer never reads the filesystem.
const [regular, semibold] = await Promise.all([
  readFile(new URL('../assets/inter-latin-400-normal.woff', import.meta.url)),
  readFile(new URL('../assets/inter-latin-600-normal.woff', import.meta.url)),
]);
await writeFile(new URL('../assets/fonts.json', import.meta.url), JSON.stringify({
  regular: regular.toString('base64'), semibold: semibold.toString('base64'),
}) + '\n');
