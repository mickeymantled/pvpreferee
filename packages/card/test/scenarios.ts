import { loadRulebook } from '@pvp/config';
import { rule } from '@pvp/rules';
import { fixtures } from '@pvp/rules/fixtures';
import type { Ruling, RulingStatus } from '@pvp/shared';

/** Invented offline stress cases, not captured chain data or real evidence. */
export function scenario(status: RulingStatus, count = 10, longText = false): Ruling {
  const fixture = structuredClone(fixtures[0]!);
  const meme = fixture.meme;
  if (longText) meme.canonical_name = 'WIDE MEME NAME '.repeat(30) + ' <script> & 🐈 中文';
  const coins = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(fixture.coins[0]!),
    // Same prefix/suffix, different middle: exercise shortened-address collisions.
    ca: 'W'.repeat(20) + String(index + 1).padStart(2, '1') + 'W'.repeat(22),
    name: meme.canonical_name,
    ticker: status === 'no_winner' || index > 0 ? 'WRONG' + (longText ? 'W'.repeat(400) : index) : meme.canonical_ticker,
    meme_id: status === 'unresolved' && index === 0 ? null :
      status === 'separate_memes' && index === 0 ? 'synthetic:other-meme' : meme.id,
    endorsements: [],
  }));
  return rule(coins, meme, loadRulebook().config);
}
