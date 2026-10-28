import { at, ca, coin, fixture, meme, snapshot } from './helpers';
const record = meme('solcat');
const a = coin(record, 'A', { flags: { bundled: true, dev_sold: true } });
const b = coin(record, 'B');
a.snapshots = [snapshot(a, at.b, { mcap_usd: 2_000, holders: 0, distinct_buyers_lifetime: 10, last_trade_at: at.a }), snapshot(a, at.c, { mcap_usd: 600_000 })];
b.snapshots = [snapshot(b, at.b, { mcap_usd: 400_000 })];
export const solcat = fixture('solcat', 'A dead OG is back at launch cap when B begins; a later revival does not count. Bundle/dev-sale warnings are display-only.', record, [a, b], {
  winner_ca: ca.B, status: 'resolved', eliminated_by: { [ca.A]: 7, [ca.B]: null },
});
