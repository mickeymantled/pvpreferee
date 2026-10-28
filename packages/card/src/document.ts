import type { CoinGrid, Ruling, RulingStatus } from '@pvp/shared';
import type { Font as Metrics } from 'opentype.js';
import { fitText, textWidth, type CardFonts } from './fonts';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 675;
export const colors = {
  background: '#0c1015', panel: '#141b23', border: '#303d4b',
  text: '#f1f5f9', muted: '#aebbc9', green: '#82efbb', greenPanel: '#142b24',
  red: '#ffaaa9', amber: '#f4d48a',
};

interface Element {
  type: 'div'; key: string;
  props: { children: Element[] | string; style: Record<string, string | number>; 'data-card-id': string };
}
interface TextLine { id: string; text: string; x: number; y: number; width: number; height: number; size: number; weight: 400 | 600; color: string }
export interface CardRow { ca: string; address: string; ticker: string; state: 'FAIL' | 'OPEN' | 'N/A'; detail: string }
export interface CardContent {
  status: RulingStatus; meme: string; coinCount: number; winner: { ca: string; name: string; chain: string } | null;
  rows: CardRow[]; version: string; configHash: string; hasUnsupportedText: boolean;
}
export interface CardDocument { element: Element; content: CardContent; lines: TextLine[] }

const statusCopy: Record<RulingStatus, { title: string; explanation: string }> = {
  resolved: { title: 'WINNER', explanation: 'Decided by the published rulebook' },
  unresolved: { title: 'Unresolved', explanation: 'More evidence or source review is needed before a winner can be named.' },
  separate_memes: { title: 'Separate memes', explanation: 'These coins represent different memes. No comparative ruling applies.' },
  no_winner: { title: 'No winner', explanation: 'Every candidate was eliminated by the rulebook.' },
};

function validate(ruling: Ruling): void {
  const cas = ruling.coin_cas;
  if (cas.length < 2 || cas.length > 10 || new Set(cas).size !== cas.length) {
    throw new Error('@pvp/card: expected 2 to 10 unique coin addresses.');
  }
  // Contracts are copied verbatim. Do not silently sanitize an address into another one.
  if (cas.some(ca => !/^[A-Za-z0-9]{1,64}$/.test(ca))) throw new Error('@pvp/card: coin addresses must be 1 to 64 ASCII letters/digits.');
  if (!Object.hasOwn(statusCopy, ruling.status)) throw new Error('@pvp/card: unknown ruling status.');
  if ((ruling.status === 'resolved') !== (ruling.winner_ca !== null) ||
    (ruling.winner_ca !== null && !cas.includes(ruling.winner_ca))) {
    throw new Error('@pvp/card: status and winner address disagree.');
  }
  for (const ca of cas) {
    const rows = ruling.grid.filter(row => row.coin === ca);
    const facts = ruling.facts.coins.filter(coin => coin.ca === ca);
    if (rows.length !== 1 || facts.length !== 1) throw new Error('@pvp/card: each coin needs exactly one grid row and frozen facts.');
    const row = rows[0]!;
    if (row.eliminated_by !== null && (row.rules[row.eliminated_by]?.result !== 'fail' ||
      !ruling.facts.config.rules.some(rule => rule.id === row.eliminated_by))) {
      throw new Error('@pvp/card: eliminating rule must reference a failed check and a frozen rule definition.');
    }
    if (ca === ruling.winner_ca && row.eliminated_by !== null) throw new Error('@pvp/card: winner cannot have an eliminating rule.');
    if (ruling.status === 'resolved' && ca !== ruling.winner_ca && row.eliminated_by === null) {
      throw new Error('@pvp/card: a resolved ruling must explain every losing coin.');
    }
    if (ruling.status === 'no_winner' && row.eliminated_by === null) throw new Error('@pvp/card: no_winner requires every coin to be eliminated.');
  }
}

function shortAddress(ca: string): string {
  return ca.length <= 16 ? ca : ca.slice(0, 6) + '...' + ca.slice(-6);
}

/** Add stable input references when abbreviated addresses would otherwise collide. */
function addresses(cas: string[]): Map<string, string> {
  return new Map(cas.map(ca => {
    const initial = shortAddress(ca);
    const peers = cas.filter(other => shortAddress(other) === initial);
    return [ca, peers.length === 1 ? initial : `#${cas.indexOf(ca) + 1} ${initial}`];
  }));
}

function firstReason(row: CoinGrid): string | undefined {
  return Object.values(row.rules).reverse().find(check => check.reason &&
    !check.reason.startsWith('Not evaluated') && !check.reason.startsWith('Not reached'))?.reason;
}

export function createDocument(ruling: Ruling, fonts: CardFonts): CardDocument {
  validate(ruling);
  let hasUnsupportedText = false;
  const clean = (input: string): string => {
    // A Latin subset deliberately avoids fallback fonts, emoji downloads and tofu boxes.
    const normalized = input.replace(/\p{Cc}|\p{Cf}/gu, ' ').replace(/\s+/gu, ' ').trim();
    return Array.from(normalized.slice(0, 4096)).map(char => {
      if (fonts.regular.charToGlyphIndex(char) > 0 && fonts.semibold.charToGlyphIndex(char) > 0) return char;
      hasUnsupportedText = true;
      return '?';
    }).join('');
  };
  const abbreviated = addresses(ruling.coin_cas);
  const ordered = [...new Set([...ruling.ranked_cas, ...ruling.coin_cas])]
    .filter(ca => ruling.coin_cas.includes(ca) && ca !== ruling.winner_ca);
  const winnerFacts = ruling.facts.coins.find(coin => coin.ca === ruling.winner_ca);
  const content: CardContent = {
    status: ruling.status,
    meme: clean(ruling.facts.meme.canonical_name) || 'Unresolved meme',
    coinCount: ruling.coin_cas.length,
    winner: winnerFacts ? { ca: winnerFacts.ca, name: clean(winnerFacts.name), chain: clean(winnerFacts.chain) } : null,
    rows: ordered.map(ca => {
      const coin = ruling.facts.coins.find(coin => coin.ca === ca)!;
      const row = ruling.grid.find(row => row.coin === ca)!;
      const eliminated = ruling.status !== 'separate_memes' && row.eliminated_by !== null;
      const definition = ruling.facts.config.rules.find(rule => rule.id === row.eliminated_by);
      const detail = eliminated
        ? `R${row.eliminated_by} ${definition!.name}: ${row.rules[row.eliminated_by!].reason || 'Failed this rule'}`
        : ruling.status === 'separate_memes' ? 'Different meme scope; no comparison' : firstReason(row) || 'Awaiting evidence or review';
      return { ca, address: abbreviated.get(ca)!, ticker: clean(coin.ticker) || '(no ticker)',
        state: eliminated ? 'FAIL' : ruling.status === 'separate_memes' ? 'N/A' : 'OPEN', detail: clean(detail) };
    }),
    version: clean(ruling.rules_version), configHash: clean(ruling.config_hash.slice(0, 12)), hasUnsupportedText: false,
  };
  content.hasUnsupportedText = hasUnsupportedText;

  const elements: Element[] = [];
  const lines: TextLine[] = [];
  const box = (id: string, x: number, y: number, width: number, height: number, style: Record<string, string | number>) => {
    elements.push({ type: 'div', key: id, props: { 'data-card-id': id, children: [],
      style: { display: 'flex', position: 'absolute', left: x, top: y, width, height, ...style } } });
  };
  const text = (id: string, value: string, x: number, y: number, width: number, height: number, size: number,
    color: string = colors.text, weight: 400 | 600 = 400, shrink = false) => {
    const font: Metrics = weight === 600 ? fonts.semibold : fonts.regular;
    if (shrink) while (size > 28 && textWidth(value, size, font) > width) size--;
    const fitted = fitText(value, width, size, font);
    lines.push({ id, text: fitted, x, y, width, height, size, color, weight });
    elements.push({ type: 'div', key: id, props: { 'data-card-id': id, children: fitted,
      style: { display: 'flex', position: 'absolute', left: x, top: y, width, height, alignItems: 'center',
        fontSize: size, fontWeight: weight, color, whiteSpace: 'pre', lineHeight: 1.15 } } });
  };

  box('brand-mark', 48, 35, 6, 26, { backgroundColor: colors.green, borderRadius: 3 });
  text('brand', 'PvP Referee', 68, 29, 400, 40, 28, colors.text, 600);
  text('edition', `ON THE RECORD  /  ${content.coinCount} COINS`, 839, 35, 313, 28, 15, colors.muted);
  box('header-line', 48, 88, 1104, 1, { backgroundColor: colors.border });
  text('meme', content.meme, 48, 107, 1104, 63, 45, colors.text, 600, true);

  const resolved = content.winner !== null;
  const accent = resolved ? colors.green : content.status === 'no_winner' ? colors.red : colors.amber;
  box('verdict-panel', 48, 187, 1104, 135, { backgroundColor: resolved ? colors.greenPanel : colors.panel, borderRadius: 12 });
  box('verdict-stripe', 48, 203, 4, 103, { backgroundColor: accent, borderRadius: 2 });
  if (content.winner) {
    text('winner-label', `WINNER  /  ${content.winner.chain.toUpperCase()}`, 72, 201, 1056, 25, 14, accent, 600);
    text('winner-name', content.winner.name || content.meme, 72, 228, 1056, 39, 28, colors.text, 600);
    let caSize = 21;
    while (textWidth(content.winner.ca, caSize, fonts.regular) > 1056) caSize--;
    text('winner-ca', content.winner.ca, 72, 275, 1056, 29, caSize, colors.green);
  } else {
    text('status-label', 'RULING STATUS', 72, 201, 1056, 25, 14, colors.muted, 600);
    text('status', statusCopy[content.status].title, 72, 230, 1056, 39, 30, accent, 600);
    text('status-explanation', statusCopy[content.status].explanation, 72, 278, 1056, 26, 18, colors.text);
  }

  text('list-label', resolved ? 'OTHER CANDIDATES' : 'CANDIDATES', 48, 338, 400, 25, 13, colors.muted, 600);
  text('list-note', 'RULE / REASON', 496, 338, 656, 25, 13, colors.muted, 600);
  const rowHeight = Math.min(57, Math.floor(240 / content.rows.length));
  const size = content.rows.length >= 7 ? 16 : 18;
  content.rows.forEach((row, index) => {
    const y = 370 + rowHeight * index;
    const color = row.state === 'FAIL' ? colors.red : colors.muted;
    if (content.rows.length < 7) box(`row-${index}-line`, 48, y + rowHeight - 1, 1104, 1, { backgroundColor: colors.border });
    text(`row-${index}-state`, row.state, 48, y, 56, rowHeight, 12, color, 600);
    text(`row-${index}-ticker`, row.ticker, 120, y, 148, rowHeight, size, colors.text, 600);
    text(`row-${index}-ca`, row.address, 286, y, 194, rowHeight, size - 1, colors.muted);
    text(`row-${index}-detail`, row.detail, 496, y, 656, rowHeight, size, color);
  });

  box('footer-line', 48, 624, 1104, 1, { backgroundColor: colors.border });
  text('version', `RULEBOOK ${content.version}  /  ${content.configHash}`, 48, 637, 440, 22, 13, colors.muted, 600);
  text('footer', hasUnsupportedText ? 'Unsupported glyphs shown as ?; full text in ruling' : 'Frozen facts. Published rules. Full evidence in ruling.',
    644, 637, 508, 22, 13, colors.muted);
  return {
    content, lines,
    element: { type: 'div', key: 'card', props: { 'data-card-id': 'card', children: elements,
      style: { display: 'flex', position: 'relative', width: CARD_WIDTH, height: CARD_HEIGHT,
        fontFamily: 'Inter', backgroundColor: colors.background } } },
  };
}
