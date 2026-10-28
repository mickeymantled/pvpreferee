import type { CoinGrid, Ruling, RulingStatus } from '@pvp/shared';
import type { Font as Metrics } from 'opentype.js';
import { fitText, textWidth, type CardFonts } from './fonts';
import brand from '../assets/brand.json';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 675;
export const colors = {
  background: '#080809', border: '#27272c',
  text: '#f3f3f4', muted: '#a0a0a8',
  green: '#9cbaaa', red: '#d69b9b', amber: '#c7b48b',
};

interface ElementStyle { style: Record<string, string | number>; 'data-card-id': string }
type Element = {
  type: 'div'; key: string;
  props: ElementStyle & { children: Element[] | string };
} | {
  type: 'img'; key: string;
  props: ElementStyle & { src: string; alt: string; width: number; height: number };
};
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

  box('brand-mark', 56, 24, 44, 44, { backgroundColor: '#000000' });
  elements.push({ type: 'img', key: 'brand-logo', props: {
    'data-card-id': 'brand-logo', src: `data:${brand.mimeType};base64,${brand.base64}`,
    alt: 'PvP Referee robotic referee', width: brand.width, height: brand.height,
    style: { position: 'absolute', left: 56, top: 24, width: 44, height: 44, objectFit: 'contain' },
  } });
  text('brand', 'PvP Referee', 116, 30, 400, 32, 22, colors.text, 600);
  text('edition', `RULING RECORD  /  ${content.coinCount} COINS`, 891, 34, 253, 24, 13, colors.muted);
  box('header-line', 56, 88, 1088, 1, { backgroundColor: colors.border });
  text('meme', content.meme, 56, 108, 1088, 62, 48, colors.text, 600, true);

  const resolved = content.winner !== null;
  if (content.winner) {
    text('winner-label', `WINNER  /  ${content.winner.chain.toUpperCase()}`, 56, 185, 1088, 22, 13, colors.green, 600);
    text('winner-name', content.winner.name || content.meme, 56, 215, 1088, 38, 28, colors.text, 600);
    let caSize = 20;
    while (textWidth(content.winner.ca, caSize, fonts.regular) > 1088) caSize--;
    text('winner-ca', content.winner.ca, 56, 262, 1088, 28, caSize, colors.text);
  } else {
    const state = content.status === 'no_winner' ? 'FAIL' : content.status === 'unresolved' ? 'OPEN' : 'N/A';
    const accent = state === 'FAIL' ? colors.red : state === 'OPEN' ? colors.amber : colors.muted;
    text('status-label', `RULING STATUS  /  ${state}`, 56, 185, 1088, 22, 13, accent, 600);
    text('status', statusCopy[content.status].title, 56, 215, 1088, 38, 30, colors.text, 600);
    text('status-explanation', statusCopy[content.status].explanation, 56, 262, 1088, 28, 18, colors.muted);
  }

  box('verdict-line', 56, 309, 1088, 1, { backgroundColor: colors.border });
  text('list-label', resolved ? 'OTHER CANDIDATES' : 'CANDIDATES', 56, 324, 388, 22, 12, colors.muted, 600);
  text('list-note', 'RULE / REASON', 464, 324, 680, 22, 12, colors.muted, 600);
  const rowHeight = Math.min(64, Math.floor(252 / content.rows.length));
  const size = content.rows.length >= 7 ? 16 : 18;
  content.rows.forEach((row, index) => {
    const y = 354 + rowHeight * index;
    const color = row.state === 'FAIL' ? colors.red : row.state === 'OPEN' ? colors.amber : colors.muted;
    if (content.rows.length < 7) box(`row-${index}-line`, 56, y + rowHeight - 1, 1088, 1, { backgroundColor: colors.border });
    text(`row-${index}-state`, row.state, 56, y, 44, rowHeight, 12, color, 600);
    text(`row-${index}-ticker`, row.ticker, 116, y, 130, rowHeight, size, colors.text, 600);
    text(`row-${index}-ca`, row.address, 262, y, 186, rowHeight, size - 1, colors.muted);
    text(`row-${index}-detail`, row.detail, 464, y, 680, rowHeight, size, colors.text);
  });

  box('footer-line', 56, 624, 1088, 1, { backgroundColor: colors.border });
  text('version', `RULEBOOK ${content.version}  /  ${content.configHash}`, 56, 637, 440, 22, 13, colors.muted, 600);
  text('footer', hasUnsupportedText ? 'Unsupported glyphs shown as ?; full text in ruling' : 'Frozen facts. Published rules. Full evidence in ruling.',
    644, 637, 500, 22, 13, colors.muted);
  return {
    content, lines,
    element: { type: 'div', key: 'card', props: { 'data-card-id': 'card', children: elements,
      style: { display: 'flex', position: 'relative', width: CARD_WIDTH, height: CARD_HEIGHT,
        fontFamily: 'Inter', backgroundColor: colors.background } } },
  };
}
