import { at, ca, coin, fixture, meme, snapshot } from './helpers';
const record = meme('robotaxi');
const a = coin(record, 'A');
const b = coin(record, 'B');
a.snapshots = [snapshot(a, at.b, { mcap_usd: 48_000, distinct_buyers_lifetime: 212, holders: 212 })];
b.snapshots = [snapshot(b, at.b, { mcap_usd: 1_000_000 })];
export const robotaxi = fixture('robotaxi', 'Generic comparison has no source-implied pair. Both use SOL; a later higher cap fixes nothing.', record, [a, b], {
  winner_ca: ca.A, status: 'resolved', eliminated_by: { [ca.A]: null, [ca.B]: 7 },
});
