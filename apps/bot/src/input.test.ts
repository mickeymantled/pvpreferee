import { describe, expect, it } from 'vitest';
import { actualMention, extractCas, originalSource, parentId } from './input';
import { ca1, ca2, config, me, mention, parent, parentMention, noSource } from './test-support';
import type { Post } from './types';

const textPost = (text: string): Post => ({ id: '1', text });
function publicKey(n: number): string {
  let value = BigInt(`0x${n.toString(16).padStart(2, '0').repeat(32)}`);
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = '';
  while (value) { result = alphabet[Number(value % 58n)] + result; value /= 58n; }
  return result;
}
describe('contract extraction', () => {
  it('deduplicates punctuation-wrapped addresses across mention and parent', () => {
    expect(extractCas([textPost(`@pvpreferee (${ca1}), [${ca2}]; ${ca1}`), textPost(ca2)])).toEqual([ca1, ca2]);
  });
  it('combines a mention with the parent and does not treat links as CAs', () => {
    expect(extractCas([parentMention, parent])).toEqual([ca1, ca2]);
    expect(() => extractCas([textPost(`https://example.org/${ca1} ${ca2}`)])).toThrow();
  });
  it('ignores unrelated long prose, invalid hashes and malformed near-CAs beside two valid CAs', () => {
    const text = `${ca1} ${ca2} ${'long_invalid_prose_'.repeat(4)} ${'0abcdef'.repeat(9)} ${ca2}X ${'1'.repeat(33)}`;
    expect(extractCas([textPost(text)])).toEqual([ca1, ca2]);
  });
  it.each([0, 1, 11])('rejects %i distinct addresses', count => {
    expect(() => extractCas([textPost(Array.from({ length: count }, (_, i) => publicKey(i + 1)).join(' '))])).toThrow();
  });
  it.each([2, 10])('accepts %i distinct 32-byte public keys', count => {
    expect(extractCas([textPost(Array.from({ length: count }, (_, i) => publicKey(i + 1)).join(' '))])).toHaveLength(count);
  });
  it.each(['0'.repeat(44), '1'.repeat(33), `0${ca2}`, `${ca2}X`, `${ca2}_`, 'é'.repeat(32)])('rejects malformed tokens without substring salvage: %s', malformed => {
    expect(() => extractCas([textPost(`${ca1} ${malformed}`)])).toThrow();
  });
});
describe('mention and source identity', () => {
  it('requires a foreign author, actual mention entity and visible mention text', () => {
    expect(actualMention(mention, me)).toBe(true);
    for (const change of [{ author_id: me.id }, { author_id: undefined }, { entities: {} }, { text: '@pvprefereefake' }, { text: 'https://example.org/@pvpreferee' }, { referenced_tweets: [{ id: '10', type: 'retweeted' as const }] }]) {
      expect(actualMention({ ...mention, ...change }, me)).toBe(false);
    }
    expect(actualMention({ ...mention, entities: { mentions: [{ username: me.username, id: '123' }] } }, me)).toBe(false);
  });
  it('uses a single explicit expanded link or referenced source parent, never guesses from a ticker', () => {
    expect(parentId(parentMention)).toBe(parent.id);
    expect(originalSource(parentMention, parent, me, config().baseUrl)).toBe('https://example.org/meme-source');
    expect(originalSource(noSource, null, me, config().baseUrl)).toBeNull();
    expect(originalSource(noSource, { id: '80', author_id: '800', text: 'An original artifact.' }, me, config().baseUrl)).toBe('https://x.com/i/web/status/80');
    expect(originalSource(noSource, { ...parent, entities: {} }, me, config().baseUrl)).toBeNull();
  });
  it('does not choose between competing links, conflicting parents, local endpoints, or trading links', () => {
    expect(originalSource(mention, { ...parent, entities: { urls: [{ expanded_url: 'https://example.org/different' }] } }, me, config().baseUrl)).toBeNull();
    expect(parentId({ ...parentMention, referenced_tweets: [{ id: '90', type: 'replied_to' }, { id: '91', type: 'quoted' }] })).toBeUndefined();
    for (const url of ['http://127.0.0.1/a', 'http://[::1]/a', 'https://localhost/a', 'https://x.com/someone', 'https://pump.fun/coin/a', 'https://ref.example.org/ruling/foo', 'https://user:pass@example.org/a']) {
      expect(originalSource({ ...mention, entities: { urls: [{ expanded_url: url }] } }, null, me, config().baseUrl)).toBeNull();
    }
  });
  it('keeps the expanded source URL path so the source authority registry can match it', () => {
    expect(originalSource({ ...mention, entities: { urls: [{ expanded_url: 'https://x.com/subject/status/123?s=20' }] } }, null, me, config().baseUrl)).toBe('https://x.com/subject/status/123');
  });
});
