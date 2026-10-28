import { at, ca, coin, fixture, meme, snapshot } from './helpers';
const record = meme('kiongozi', { canonical_name: 'Kiongozi', canonical_ticker: 'KIONGOZI', beneficiary_wallet: 'synthetic-charity', beneficiary_tie_at: at.before });
const a = coin(record, 'A', { fee_wallet: record.beneficiary_wallet, fee_tie_at: at.before, beneficiary_claimable: true });
const b = coin(record, 'B', { ticker: 'KIO' });
a.snapshots = [snapshot(a, at.b, { mcap_usd: 25_000 })];
b.snapshots = [snapshot(b, at.b, { mcap_usd: 1_500_000 })];
export const kiongozi = fixture('kiongozi', 'Exact subject ticker and pre-tied charity fees on A; larger B has the incorrect ticker KIO.', record, [a, b], {
  winner_ca: ca.A, status: 'resolved', eliminated_by: { [ca.A]: null, [ca.B]: 2 },
});
