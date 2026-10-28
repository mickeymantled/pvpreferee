import { ca, coin, fixture, meme, snapshot } from './helpers';
const record = meme('invisible_cat');
const rivalAt = '2026-10-27T10:00:00.000Z';
const revivalAt = '2026-10-28T10:00:00.000Z';
const a = coin(record, 'A', { deployed_at: '2026-10-08T10:00:00.000Z', first_real_buy_at: revivalAt });
const b = coin(record, 'B', { deployed_at: rivalAt, first_real_buy_at: rivalAt });
a.snapshots = [snapshot(a, rivalAt, { mcap_usd: 2_000, holders: 0, distinct_buyers_lifetime: 0, last_trade_at: null }), snapshot(a, revivalAt)];
b.snapshots = [snapshot(b, revivalAt, { mcap_usd: 200_000 })];
export const invisibleCat = fixture('invisible_cat', 'A deployed 19 days before B, with no trades at B first buy; A only finds participation after B runs.', record, [a, b], {
  winner_ca: ca.B, status: 'resolved', eliminated_by: { [ca.A]: 7, [ca.B]: null },
});
