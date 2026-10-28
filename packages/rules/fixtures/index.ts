import type { RuleFixture } from '@pvp/shared';
import { robotaxi } from './robotaxi';
import { robotaxiTsla } from './robotaxi-tsla';
import { invisibleCat } from './invisible-cat';
import { kimchi } from './kimchi';
import { kimchiQr } from './kimchi-qr';
import { kiongozi } from './kiongozi';
import { tilcayo, tilcayoSameMeme } from './tilcayo';
import { solcat } from './solcat';
import { czBnb } from './cz-bnb';

/** Nine named disputes plus the explicit same-meme Tilcayo variant. All data is synthetic. */
export const fixtures: RuleFixture[] = [robotaxi, robotaxiTsla, invisibleCat, kimchi, kimchiQr, kiongozi, tilcayo, tilcayoSameMeme, solcat, czBnb];
