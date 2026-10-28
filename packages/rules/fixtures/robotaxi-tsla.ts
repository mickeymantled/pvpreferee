import { at, ca, coin, fixture, meme, snapshot } from './helpers';
const record = meme('robotaxi', { implied_pair: 'TSLA' });
const a = coin(record, 'A');
const b = coin(record, 'B', { pair_asset: 'TSLA' });
a.snapshots = [snapshot(a, at.b)];
export const robotaxiTsla = fixture('robotaxi_tsla', 'Explicit source-implied TSLA pair beats an earlier alive SOL pair.', record, [a, b], {
  winner_ca: ca.B, status: 'resolved', eliminated_by: { [ca.A]: 5, [ca.B]: null },
});
