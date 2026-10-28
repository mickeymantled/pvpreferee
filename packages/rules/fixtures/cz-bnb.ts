import { at, ca, coin, fixture, meme, snapshot } from './helpers';
const record = meme('cz_bnb', { home_chain: 'bnb', implied_pair: 'BNB' });
const a = coin(record, 'A');
const b = coin(record, 'B', { chain: 'bnb', pair_asset: 'BNB' });
a.snapshots = [snapshot(a, at.b)];
export const czBnb = fixture('cz_bnb', 'CZ source is BNB-native; earlier Solana coin fails chain fit.', record, [a, b], {
  winner_ca: ca.B, status: 'resolved', eliminated_by: { [ca.A]: 4, [ca.B]: null },
});
