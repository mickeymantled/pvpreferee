import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { hashRulebook, loadRulebook } from '@pvp/config';
import { canonicalJson, type CoinFacts, type RuleFixture } from '@pvp/shared';
import { fixtures } from '../fixtures';
import { at, ca, coin, endorsement, snapshot } from '../fixtures/helpers';
import { rule } from './index';

const config = (): ReturnType<typeof loadRulebook>['config'] => loadRulebook().config;
function get(name = 'robotaxi'): RuleFixture {
  const found = fixtures.find(item => item.name === name);
  if (!found) throw new Error('Missing test fixture: ' + name);
  return structuredClone(found);
}
function run(fixture: RuleFixture) { return rule(fixture.coins, fixture.meme, config()); }
function elimination(result: ReturnType<typeof rule>) {
  return Object.fromEntries(result.grid.map(row => [row.coin, row.eliminated_by]));
}
function permutations<T>(items: T[]): T[][] {
  return items.length <= 1 ? [items] : items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index)).map(rest => [item, ...rest]));
}
function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
}

describe('published synthetic dispute fixtures', () => {
  it('exports all nine named rows plus the same-meme variant', () => {
    expect(fixtures.map(item => item.name)).toEqual([
      'robotaxi', 'robotaxi_tsla', 'invisible_cat', 'kimchi', 'kimchi_qr', 'kiongozi', 'tilcayo', 'tilcayo_same_meme', 'solcat', 'cz_bnb',
    ]);
    expect(fixtures.every(item => item.synthetic === true && item.description.startsWith('SYNTHETIC'))).toBe(true);
  });
  for (const fixture of fixtures) {
    it(fixture.name + ': exact winner, status, eliminating rule, and evidence grid', () => {
      const result = run(fixture);
      expect(result.status).toBe(fixture.expected.status);
      expect(result.winner_ca).toBe(fixture.expected.winner_ca);
      expect(elimination(result)).toEqual(fixture.expected.eliminated_by);
      for (const row of result.grid) {
        expect(Object.keys(row.rules)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
        if (row.eliminated_by !== null) {
          const check = row.rules[row.eliminated_by];
          expect(check.result).toBe('fail');
          expect(check.reason).toBeTruthy();
          expect(check.evidence?.length).toBeGreaterThan(0);
        }
      }
    });
    it(fixture.name + ': invariant across every input permutation', () => {
      const expected = run(fixture);
      for (const coins of permutations(fixture.coins)) expect(rule(coins, fixture.meme, config())).toEqual(expected);
    });
  }
});

describe('frozen provenance and scope', () => {
  it('hashes the complete frozen facts canonically, uses config exports and max observed_at', () => {
    const fixture = get();
    fixture.coins[0]!.observed_at = '2026-10-27T12:00:00Z';
    const result = run(fixture);
    expect(result.config_hash).toBe(hashRulebook(config()));
    expect(result.facts_hash).toBe(createHash('sha256').update(canonicalJson(result.facts)).digest('hex'));
    expect(result.id).toBe('ruling_' + result.facts_hash);
    expect(result.share_slug).toBe('r-' + result.facts_hash);
    expect(result.created_at).toBe('2026-10-28T12:00:00.000Z');
    expect(result.facts).toEqual({ coins: fixture.coins, meme: fixture.meme, config: config() });
  });
  it('does not mutate or retain mutable aliases to inputs', () => {
    const fixture = get();
    const configuration = config();
    freeze(fixture);
    freeze(configuration);
    const result = rule(fixture.coins, fixture.meme, configuration);
    result.facts.coins[0]!.name = 'mutated output';
    result.grid[0]!.flags.dev_sold = true;
    expect(fixture.coins[0]!.name).toBe('robotaxi');
    expect(fixture.coins[0]!.flags).toEqual({});
  });
  it('never reads wall-clock time or randomness', () => {
    const now = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('No clock'); });
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('No randomness'); });
    try { expect(run(get()).status).toBe('resolved'); } finally { now.mockRestore(); random.mockRestore(); }
  });
  it('returns separate_memes without invented rankings or eliminations, even with endorsements', () => {
    const fixture = get('tilcayo');
    fixture.coins[1]!.endorsements = [endorsement(fixture.coins[1]!, null, 'ca_post')];
    const result = run(fixture);
    expect(result.status).toBe('separate_memes');
    expect(result.winner_ca).toBeNull();
    expect(result.ranked_cas).toEqual([]);
    expect(result.grid.every(row => row.eliminated_by === null && Object.values(row.rules).every(check => check.result === 'na'))).toBe(true);
  });
  it('does not silently attach unresolved meme assignments', () => {
    const fixture = get();
    fixture.coins[0]!.meme_id = null;
    expect(run(fixture).status).toBe('unresolved');
  });
  it('does not infer TSLA from the robotaxi slug when no pair is supplied', () => {
    expect(get().meme.implied_pair).toBeNull();
    expect(run(get()).winner_ca).toBe(ca.A);
    expect(run(get('robotaxi_tsla')).winner_ca).toBe(ca.B);
  });
  it.each([0, 1, 11])('rejects invalid input size %s', count => {
    const coins = Array.from({ length: count }, () => get().coins[0]!);
    expect(() => rule(coins, get().meme, config())).toThrow('2 to 10');
  });
  it('rejects duplicate CAs and invalid observed_at instead of inventing provenance', () => {
    const fixture = get();
    fixture.coins[1]!.ca = fixture.coins[0]!.ca;
    expect(() => run(fixture)).toThrow('unique');
    fixture.coins[1]!.ca = ca.B;
    fixture.coins[0]!.observed_at = 'unknown';
    expect(() => run(fixture)).toThrow('observed_at');
  });
  it('flags can change provenance and display but never winner, elimination, or rule reasons', () => {
    const fixture = get('solcat');
    const before = run(fixture);
    fixture.coins[0]!.flags = { top10_pct: 0, creator_launches_30d: 0, dev_sold: false, bundled: false, cto: true, dex_paid: true, verified_badges: ['synthetic-badge'] };
    fixture.coins[1]!.flags = { top10_pct: 100, creator_launches_30d: 10000, dev_sold: true, bundled: true, warnings: ['synthetic warning'] };
    const after = run(fixture);
    expect(after.winner_ca).toBe(before.winner_ca);
    expect(elimination(after)).toEqual(elimination(before));
    expect(after.grid.map(row => row.rules)).toEqual(before.grid.map(row => row.rules));
    expect(after.facts_hash).not.toBe(before.facts_hash);
    expect(after.flags[ca.B]).toEqual(fixture.coins[1]!.flags);
  });
});

describe('endorsement precedence and supply conflicts', () => {
  it.each(['ca_post', 'fee_claim'] as const)('a lone verified %s wins with unknown holdings', kind => {
    const fixture = get();
    fixture.coins[1]!.endorsements = [endorsement(fixture.coins[1]!, null, kind)];
    const result = run(fixture);
    expect(result.winner_ca).toBe(ca.B);
    expect(elimination(result)).toEqual({ [ca.A]: 1, [ca.B]: null });
  });
  it('a lone endorsement has no minimum percentage, including known zero holdings', () => {
    const fixture = get();
    fixture.coins[1]!.subject_held_supply_pct = 0;
    fixture.coins[1]!.endorsements = [endorsement(fixture.coins[1]!, 0, 'ca_post')];
    expect(run(fixture).winner_ca).toBe(ca.B);
  });
  it('multiple endorsed coins with any unknown holdings remain unresolved', () => {
    const fixture = get('kimchi_qr');
    fixture.coins[2]!.subject_held_supply_pct = null;
    fixture.coins[2]!.endorsements[0]!.subject_held_supply_pct = null;
    const result = run(fixture);
    expect(result.status).toBe('unresolved');
    expect(result.winner_ca).toBeNull();
    expect(result.grid.every(row => row.eliminated_by === null)).toBe(true);
  });
  it('lower later endorsement is a conflict, with no transfer', () => {
    const result = run(get('kimchi_qr'));
    expect(result.grid.find(row => row.coin === ca.C)!.rules[1].reason).toContain('Endorsement conflict');
    expect(result.winner_ca).toBe(ca.B);
  });
  it('greater subject-held supply can transfer priority even if later', () => {
    const fixture = get('kimchi_qr');
    fixture.coins[2]!.subject_held_supply_pct = 80;
    fixture.coins[2]!.endorsements[0]!.subject_held_supply_pct = 80;
    const result = run(fixture);
    expect(result.winner_ca).toBe(ca.C);
    expect(elimination(result)).toEqual({ [ca.A]: 1, [ca.B]: 1, [ca.C]: null });
  });
  it('equal supply is unresolved, never broken by timestamp, CA, or deployment', () => {
    const fixture = get('kimchi_qr');
    fixture.coins[2]!.subject_held_supply_pct = 75;
    fixture.coins[2]!.endorsements[0]!.subject_held_supply_pct = 75;
    expect(run(fixture).status).toBe('unresolved');
  });
  it('conflicting supply records are unresolved rather than choosing the largest', () => {
    const fixture = get('kimchi_qr');
    fixture.coins[1]!.endorsements.push({ ...fixture.coins[1]!.endorsements[0]!, subject_held_supply_pct: 30 });
    const result = run(fixture);
    expect(result.status).toBe('unresolved');
    expect(result.grid[0]!.rules[1].reason).toContain('Conflicting');
  });
  it.each(['unverified', 'missing_evidence', 'blank_evidence', 'future', 'wrong_ca'] as const)('does not use %s endorsement evidence', issue => {
    const fixture = get('kimchi');
    const item = fixture.coins[1]!.endorsements[0]!;
    if (issue === 'unverified') item.verified_by = null;
    if (issue === 'missing_evidence') item.evidence_url = null;
    if (issue === 'blank_evidence') item.evidence_url = '  ';
    if (issue === 'future') item.at = '2027-01-01T00:00:00Z';
    if (issue === 'wrong_ca') item.coin_ca = ca.A;
    expect(run(fixture).status).toBe('unresolved');
  });
  it('rule 1 wins before identity, pair, or participation can revive its loser', () => {
    const fixture = get('kimchi');
    fixture.coins[1]!.ticker = 'SYNTHETIC_DIFFERENT_TICKER';
    fixture.coins[1]!.pair_asset = 'OTHER';
    fixture.coins[1]!.image_hash = fixture.coins[0]!.image_hash;
    const result = run(fixture);
    expect(result.winner_ca).toBe(ca.B);
    expect(result.grid[0]!.eliminated_by).toBe(1);
    expect(result.grid[1]!.rules[2].result).toBe('na');
  });
});

describe('identity and provided image/press evidence', () => {
  it('an earlier identity failure cannot be rescued by fees, age, or participation', () => {
    const fixture = get();
    fixture.coins[0]!.ticker = 'WRONG';
    fixture.meme.beneficiary_wallet = fixture.coins[0]!.fee_wallet;
    fixture.meme.beneficiary_tie_at = at.before;
    fixture.coins[0]!.fee_tie_at = at.before;
    fixture.coins[0]!.beneficiary_claimable = true;
    const result = run(fixture);
    expect(result.winner_ca).toBe(ca.B);
    expect(result.grid[0]!.eliminated_by).toBe(2);
    expect(result.grid[0]!.rules[6].result).toBe('na');
  });
  it('scores name and ticker independently and keeps exact spelling', () => {
    const fixture = get();
    fixture.coins[1]!.name = 'Robotaxi';
    fixture.coins[1]!.ticker = 'robotaxi';
    const result = run(fixture);
    expect(result.grid[1]!.rules[2].reason).toContain('Name "Robotaxi"');
    expect(result.grid[1]!.rules[2].reason).toContain('Ticker "robotaxi"');
    expect(result.grid[1]!.eliminated_by).toBe(2);
  });
  it('fails a supplied similar hash only when the earlier coin is alive at the exact instant', () => {
    const fixture = get();
    fixture.coins[1]!.image_hash = '0000000000000001';
    const result = run(fixture);
    expect(result.grid[1]!.eliminated_by).toBe(2);
    expect(result.grid[1]!.rules[2].reason).toContain('distance 1');
    fixture.coins[0]!.snapshots[0]!.mcap_usd = 2_000;
    expect(run(fixture).winner_ca).toBe(ca.B);
    expect(run(fixture).grid[1]!.rules[2].result).toBe('pass');
  });
  it('accepts 64-bit binary hashes without interpreting them as hexadecimal', () => {
    const fixture = get();
    fixture.coins[0]!.image_hash = '0'.repeat(64);
    fixture.coins[1]!.image_hash = '0'.repeat(63) + '1';
    expect(run(fixture).grid[1]!.eliminated_by).toBe(2);
  });
  it.each([null, '', 'invalid-hash'])('unknown image hash %s does not invent a similarity or a pass', value => {
    const fixture = get();
    fixture.coins[1]!.image_hash = value;
    const result = run(fixture);
    expect(result.status).toBe('unresolved');
    expect(result.grid[1]!.eliminated_by).toBeNull();
    expect(result.grid[1]!.rules[2].reason).toContain('Image hash evidence is unknown');
  });
  it('absent image hashes are immaterial once the earlier coin is proved dead', () => {
    const fixture = get('solcat');
    fixture.coins.forEach(item => { item.image_hash = null; });
    expect(run(fixture).winner_ca).toBe(ca.B);
  });
  it.each(['source', 'coin', 'unresolved'] as const)('missing %s evidence cannot grant an identity guess', missing => {
    const fixture = get();
    if (missing === 'source') fixture.meme.source_url = '';
    if (missing === 'coin') fixture.coins[0]!.evidence = [];
    if (missing === 'unresolved') fixture.meme.resolved = false;
    expect(run(fixture).status).toBe('unresolved');
  });
  it('does not let duplicate, tracking, or unlisted press URLs inflate the canonical count', () => {
    const fixture = get('tilcayo_same_meme');
    fixture.meme.press_candidates![0]!.articles = [
      'https://www.bbc.com/synthetic-pvp-fixture/tilcayo-1?utm_source=a',
      'https://bbc.com/synthetic-pvp-fixture/tilcayo-1/?fbclid=b',
      'https://bbc.com.attacker.invalid/synthetic/2',
      'https://unlisted.invalid/synthetic/3',
    ];
    expect(run(fixture).winner_ca).toBe(ca.B);
  });
  it('counts distinct query-addressed articles while deduplicating tracking variants', () => {
    const fixture = get('tilcayo_same_meme');
    fixture.meme.press_candidates = [
      { value: 'Tilcayo', articles: ['https://bbc.com/synthetic/article?id=1'] },
      { value: 'Tigrino', articles: [
        'https://www.bbc.com/synthetic/article/?id=2&utm_source=x',
        'https://bbc.com/synthetic/article?id=3',
        'https://bbc.com/synthetic/article?fbclid=x&id=2',
      ] },
    ];
    expect(run(fixture).winner_ca).toBe(ca.B);
  });
  it('equal eligible press counts leave canonical name unresolved', () => {
    const fixture = get('tilcayo_same_meme');
    fixture.meme.press_candidates![1]!.articles.pop();
    expect(run(fixture).status).toBe('unresolved');
  });
});

describe('chain, pair, launchpad, and beneficiary precedence', () => {
  it('chain mismatch cannot be rescued by a correct pair', () => {
    const fixture = get('cz_bnb');
    fixture.coins[0]!.pair_asset = 'BNB';
    expect(run(fixture).grid[0]!.eliminated_by).toBe(4);
  });
  it('wrong pair loses even if it had beneficiary priority', () => {
    const fixture = get('robotaxi_tsla');
    fixture.meme.beneficiary_wallet = fixture.coins[0]!.fee_wallet;
    fixture.meme.beneficiary_tie_at = at.before;
    fixture.coins[0]!.fee_tie_at = at.before;
    fixture.coins[0]!.beneficiary_claimable = true;
    expect(run(fixture).winner_ca).toBe(ca.B);
    expect(run(fixture).grid[0]!.eliminated_by).toBe(5);
  });
  it('unknown pair is unresolved, while every known wrong pair produces no_winner', () => {
    const fixture = get();
    fixture.coins[0]!.pair_asset = null;
    expect(run(fixture).status).toBe('unresolved');
    fixture.coins.forEach(item => { item.pair_asset = 'WRONG'; });
    const result = run(fixture);
    expect(result.status).toBe('no_winner');
    expect(elimination(result)).toEqual({ [ca.A]: 5, [ca.B]: 5 });
  });
  it('a launchpad port loses at rule 5 unless the source points there', () => {
    const fixture = get();
    fixture.coins[1]!.launchpad = 'synthetic-other-pad';
    expect(run(fixture).grid[1]!.eliminated_by).toBe(5);
    fixture.meme.source_launchpad = 'synthetic-other-pad';
    const result = run(fixture);
    expect(result.grid[1]!.rules[5].result).toBe('pass');
    expect(result.grid[1]!.eliminated_by).toBe(7);
  });
  it('correct pair still wins when it also moves to a different launchpad', () => {
    const fixture = get('robotaxi_tsla');
    fixture.coins[1]!.launchpad = 'synthetic-other-pad';
    expect(run(fixture).winner_ca).toBe(ca.B);
  });
  function beneficiaryFixture() {
    const fixture = get();
    fixture.meme.beneficiary_wallet = 'synthetic-shelter';
    fixture.meme.beneficiary_tie_at = at.before;
    Object.assign(fixture.coins[1]!, { fee_wallet: fixture.meme.beneficiary_wallet, fee_tie_at: at.before, beneficiary_claimable: true });
    return fixture;
  }
  it('claimable beneficiary fees tied before the rival first buy defeat its participation priority', () => {
    const result = run(beneficiaryFixture());
    expect(result.winner_ca).toBe(ca.B);
    expect(elimination(result)).toEqual({ [ca.A]: 6, [ca.B]: null });
  });
  it.each(['late', 'equal', 'unclaimable'] as const)('%s beneficiary tie does not override an alive incumbent', condition => {
    const fixture = beneficiaryFixture();
    if (condition === 'late') fixture.coins[1]!.fee_tie_at = at.b;
    if (condition === 'equal') fixture.coins[1]!.fee_tie_at = at.a;
    if (condition === 'unclaimable') fixture.coins[1]!.beneficiary_claimable = false;
    expect(run(fixture).winner_ca).toBe(ca.A);
    expect(run(fixture).grid[1]!.eliminated_by).toBe(7);
  });
  it.each(['fee_tie_at', 'beneficiary_claimable', 'fee_wallet'] as const)('missing %s keeps beneficiary advantage unresolved', field => {
    const fixture = beneficiaryFixture();
    fixture.coins[1]![field] = null;
    expect(run(fixture).status).toBe('unresolved');
  });
});

describe('exact frozen participation and chronological contenders', () => {
  it('A alive at B eliminates B; dead A at C lets C win despite B alive at C', () => {
    const fixture = get();
    const c = coin(fixture.meme, 'C');
    fixture.coins[0]!.snapshots.push(snapshot(fixture.coins[0]!, at.c, { mcap_usd: 2_000 }));
    fixture.coins[1]!.snapshots.push(snapshot(fixture.coins[1]!, at.c, { mcap_usd: 1_000_000 }));
    fixture.coins.push(c);
    for (const coins of permutations(fixture.coins)) {
      const result = rule(coins, fixture.meme, config());
      expect(result.status).toBe('resolved');
      expect(result.winner_ca).toBe(ca.C);
      expect(elimination(result)).toEqual({ [ca.A]: 7, [ca.B]: 7, [ca.C]: null });
    }
  });
  it('a dead incumbent cannot return later to eliminate a survivor', () => {
    const fixture = get('solcat');
    const c = coin(fixture.meme, 'C');
    fixture.coins[1]!.snapshots.push(snapshot(fixture.coins[1]!, at.c));
    fixture.coins.push(c);
    const result = run(fixture);
    expect(result.winner_ca).toBe(ca.B);
    expect(elimination(result)).toEqual({ [ca.A]: 7, [ca.B]: null, [ca.C]: 7 });
  });
  it('unknown later transition preserves proven prior eliminations and returns unresolved', () => {
    const fixture = get();
    fixture.coins.push(coin(fixture.meme, 'C'));
    const result = run(fixture);
    expect(result.status).toBe('unresolved');
    expect(result.grid[1]!.eliminated_by).toBe(7);
    expect(result.grid[0]!.eliminated_by).toBeNull();
    expect(result.grid[2]!.eliminated_by).toBeNull();
  });
  it.each(['future', 'past'] as const)('a %s snapshot cannot substitute for the exact rival instant', direction => {
    const fixture = get();
    fixture.coins[0]!.snapshots[0]!.at = direction === 'future' ? at.c : at.a;
    const result = run(fixture);
    expect(result.status).toBe('unresolved');
    expect(result.winner_ca).toBeNull();
    expect(result.grid[0]!.rules[7].reason).toContain('exact rival first real buy');
  });
  it('future volume is ignored when an exact dead snapshot exists', () => {
    const fixture = get('solcat');
    fixture.coins[0]!.snapshots[1]!.mcap_usd = 1_000_000_000;
    expect(run(fixture).winner_ca).toBe(ca.B);
  });
  it('cap threshold is measured above launch baseline, not as an absolute cap', () => {
    const fixture = get();
    fixture.coins[0]!.launch_mcap_usd = 48_000;
    expect(run(fixture).winner_ca).toBe(ca.B);
    expect(run(fixture).grid[0]!.eliminated_by).toBe(7);
  });
  it('both buyer and relative-cap minima are inclusive and necessary', () => {
    const fixture = get();
    Object.assign(fixture.coins[0]!.snapshots[0]!, { mcap_usd: 2_100, distinct_buyers_lifetime: 3 });
    expect(run(fixture).winner_ca).toBe(ca.A);
    fixture.coins[0]!.snapshots[0]!.distinct_buyers_lifetime = 2;
    expect(run(fixture).winner_ca).toBe(ca.B);
    fixture.coins[0]!.snapshots[0]!.distinct_buyers_lifetime = 3;
    fixture.coins[0]!.snapshots[0]!.mcap_usd = 2_099;
    expect(run(fixture).winner_ca).toBe(ca.B);
  });
  it.each(['mcap_usd', 'holders', 'distinct_buyers_lifetime'] as const)('missing snapshot %s is unknown, never zero', field => {
    const fixture = get();
    fixture.coins[0]!.snapshots[0]![field] = null;
    expect(run(fixture).status).toBe('unresolved');
  });
  it('missing launch baseline cannot be replaced with zero', () => {
    const fixture = get();
    fixture.coins[0]!.launch_mcap_usd = null;
    expect(run(fixture).status).toBe('unresolved');
  });
  it.each(['incomplete', 'future_trade', 'wrong_config', 'empty_config', 'wrong_ca', 'no_evidence', 'no_source'] as const)('rejects %s snapshot evidence', issue => {
    const fixture = get();
    const state = fixture.coins[0]!.snapshots[0]!;
    if (issue === 'incomplete') state.complete = false;
    if (issue === 'future_trade') state.last_trade_at = at.c;
    if (issue === 'wrong_config') state.config_hash = 'wrong-config';
    if (issue === 'empty_config') state.config_hash = '';
    if (issue === 'wrong_ca') state.coin_ca = ca.B;
    if (issue === 'no_evidence') state.evidence = [];
    if (issue === 'no_source') state.source = '';
    expect(run(fixture).status).toBe('unresolved');
  });
  it('conflicting exact snapshots are unresolved, independent of array order', () => {
    const fixture = get();
    fixture.coins[0]!.snapshots.push({ ...fixture.coins[0]!.snapshots[0]!, id: 'synthetic-conflict', mcap_usd: 2_000 });
    expect(run(fixture).status).toBe('unresolved');
    fixture.coins[0]!.snapshots.reverse();
    expect(run(fixture).status).toBe('unresolved');
  });
  it('timestamps with equivalent UTC representations refer to the same exact instant', () => {
    const fixture = get();
    fixture.coins[0]!.snapshots[0]!.at = '2026-10-02T10:00:00Z';
    expect(run(fixture).winner_ca).toBe(ca.A);
  });
  it('tied first buys remain unresolved at rule 8, never broken by deployment or CA', () => {
    const fixture = get();
    fixture.coins[1]!.first_real_buy_at = at.a;
    fixture.coins[0]!.snapshots = [snapshot(fixture.coins[0]!, at.a)];
    fixture.coins[1]!.snapshots = [snapshot(fixture.coins[1]!, at.a)];
    fixture.coins[1]!.deployed_at = '2020-01-01T00:00:00Z';
    const result = run(fixture);
    expect(result.status).toBe('unresolved');
    expect(result.winner_ca).toBeNull();
    expect(elimination(result)).toEqual({ [ca.A]: null, [ca.B]: null });
    expect(result.grid.every(row => row.rules[8].reason?.includes('timestamps tie'))).toBe(true);
  });
  it.each(['first_real_buy_at', 'evidence'] as const)('does not invent missing %s', field => {
    const fixture = get();
    if (field === 'first_real_buy_at') fixture.coins[0]!.first_real_buy_at = null;
    else fixture.coins[0]!.evidence = [];
    expect(run(fixture).status).toBe('unresolved');
  });
  it('works for the maximum ten inputs without using an invalid vamp as an incumbent', () => {
    const fixture = get();
    const entrants: CoinFacts[] = [];
    for (let i = 2; i <= 10; i++) {
      const instant = '2026-10-' + String(i).padStart(2, '0') + 'T10:00:00.000Z';
      const item = coin(fixture.meme, 'B', { ca: 'synthetic-ca-' + i, first_real_buy_at: instant });
      // Dissimilar only from the incumbent; equal images among vamps would trigger
      // rule 2, so use a shared null-free image pattern and dead vamp snapshots.
      item.image_hash = 'ffffffffffffffff';
      entrants.push(item);
      fixture.coins[0]!.snapshots.push(snapshot(fixture.coins[0]!, instant));
    }
    // Every later image is independently far from the incumbent. It need not be
    // judged against a same-image rival proved dead at that exact instant.
    for (const item of entrants) for (const rival of entrants) {
      if (item.first_real_buy_at! < rival.first_real_buy_at!) item.snapshots.push(snapshot(item, rival.first_real_buy_at!, { mcap_usd: 2_000 }));
    }
    fixture.coins[0]!.snapshots = fixture.coins[0]!.snapshots.filter((state, index, list) => list.findIndex(other => other.at === state.at) === index);
    fixture.coins = [fixture.coins[0]!, ...entrants];
    const result = run(fixture);
    expect(result.winner_ca).toBe(ca.A);
    expect(result.grid.filter(row => row.eliminated_by === 7)).toHaveLength(9);
  });
});
