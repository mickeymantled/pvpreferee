import { mkdir, writeFile } from 'node:fs/promises';
import { loadRulebook } from '@pvp/config';
import { rule } from '@pvp/rules';
import { fixtures } from '@pvp/rules/fixtures';
import { renderRulingCard } from '../src/index';
import { scenario } from '../test/scenarios';

const directory = new URL('../.artifacts/', import.meta.url);
await mkdir(directory, { recursive: true });
const samples = fixtures.map(fixture => ({ name: fixture.name, ruling: rule(fixture.coins, fixture.meme, loadRulebook().config) }));
for (const status of ['resolved', 'unresolved', 'separate_memes', 'no_winner'] as const) {
  samples.push({ name: `ten-coins-${status}`, ruling: scenario(status) });
}
samples.push({ name: 'long-text-ten-coins', ruling: scenario('resolved', 10, true) });
for (const { name, ruling } of samples) {
  const path = new URL(name + '.png', directory);
  await writeFile(path, await renderRulingCard(ruling));
  console.log(path.pathname);
}
