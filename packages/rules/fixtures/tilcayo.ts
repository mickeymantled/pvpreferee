import { at, ca, coin, fixture, meme, syntheticUrl } from './helpers';
const record = meme('tilcayo', { canonical_name: 'Tigrino', canonical_ticker: 'TIGRINO', beneficiary_wallet: 'synthetic-shelter', beneficiary_tie_at: at.before });
const a = coin(record, 'A', { name: 'Tilcayo', ticker: 'TILCAYO', scope: 'concept', meme_id: 'synthetic:tilcayo-species' });
const b = coin(record, 'B', { fee_wallet: record.beneficiary_wallet, fee_tie_at: at.before, beneficiary_claimable: true });
export const tilcayo = fixture('tilcayo', 'Tilcayo species concept and Tigrino specific pet are separate memes; the shelter tie predates A.', record, [a, b], {
  winner_ca: null, status: 'separate_memes', eliminated_by: { [ca.A]: null, [ca.B]: null },
});

const same = structuredClone(record);
same.press_candidates = [
  { value: 'Tilcayo', articles: ['https://www.bbc.com/synthetic-pvp-fixture/tilcayo-1'] },
  { value: 'Tigrino', articles: ['https://www.bbc.com/synthetic-pvp-fixture/tigrino-1', 'https://apnews.com/synthetic-pvp-fixture/tigrino-2'] },
];
same.evidence.push(syntheticUrl('tilcayo/same-meme-editorial-assumption'));
const sameA = { ...structuredClone(a), meme_id: same.id, scope: same.scope, ticker: same.canonical_ticker };
const sameB = structuredClone(b);
export const tilcayoSameMeme = fixture('tilcayo_same_meme', 'Explicit same-meme interpretation. Synthetic eligible press counts favor Tigrino 2:1; B also carries pre-tied shelter fees.', same, [sameA, sameB], {
  winner_ca: ca.B, status: 'resolved', eliminated_by: { [ca.A]: 2, [ca.B]: null },
});
