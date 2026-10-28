import { at, ca, coin, endorsement, fixture, snapshot } from './helpers';
import { kimchi } from './kimchi';
const record = structuredClone(kimchi.meme);
const [a, b] = structuredClone(kimchi.coins);
const c = coin(record, 'C', { subject_held_supply_pct: 1 });
c.endorsements = [endorsement(c, 1, 'ca_post')];
b!.snapshots = [snapshot(b!, at.c)];
export const kimchiQr = fixture('kimchi_qr', 'Later subject QR endorses C with synthetic 1% subject holdings; B retains its 75% priority.', record, [a!, b!, c], {
  winner_ca: ca.B, status: 'resolved', eliminated_by: { [ca.A]: 1, [ca.B]: null, [ca.C]: 1 },
});
