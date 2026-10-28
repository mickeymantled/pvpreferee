import { at, ca, coin, endorsement, fixture, meme, snapshot } from './helpers';
const record = meme('kimchi', { subject_handle: 'synthetic-kimchi-subject' });
const a = coin(record, 'A', { first_real_buy_at: '2026-07-01T10:00:00.000Z', deployed_at: '2026-07-01T09:00:00.000Z' });
const b = coin(record, 'B', { subject_held_supply_pct: 75 });
a.snapshots = [snapshot(a, at.b, { mcap_usd: 7_000_000 })];
b.endorsements = [endorsement(b, 75)];
export const kimchi = fixture('kimchi', 'A has run for months at $7M. B supplies 75% to the verified subject wallet linked by a subject video.', record, [a, b], {
  winner_ca: ca.B, status: 'resolved', eliminated_by: { [ca.A]: 1, [ca.B]: null },
});
