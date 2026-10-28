import { cp, access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';

const web = fileURLToPath(new URL('..', import.meta.url));
const standalone = path.join(web, '.next/standalone/apps/web');
try {
  await access(path.join(standalone, 'server.js'));
  await cp(path.join(web, '.next/static'), path.join(standalone, '.next/static'), { recursive: true, force: true });
  try { await access(path.join(web, 'public')); await cp(path.join(web, 'public'), path.join(standalone, 'public'), { recursive: true, force: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  process.env.HOSTNAME = process.env.WEB_HOST || '127.0.0.1';
  await import(pathToFileURL(path.join(standalone, 'server.js')).href);
} catch (error) {
  console.error('Standalone start failed. Run pnpm --filter @pvp/web build first.', error.code ?? '');
  process.exitCode = 1;
}
