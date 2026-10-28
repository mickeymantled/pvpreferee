import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OriginRecovery, OriginResearch } from './origin-research';
import { INPUT } from '../test/fixtures';

describe('automatic origin research presentation', () => {
  it('labels listing links as leads rather than original-source proof', () => {
    const html = renderToStaticMarkup(<OriginResearch input={{ ...INPUT, source_url: '' }} discovery={{
      notes: ['Synthetic lookup, not live data.'],
      candidates: [{ url: 'https://source.example/meme', coin_cas: INPUT.cas,
        discovered_via: ['https://api.dexscreener.com/tokens/v1/solana/synthetic'], status: 'unverified', reasons: ['Authority not verified.'] }],
    }} />);
    expect(html).toContain('leads, not proof');
    expect(html).toContain('Unverified origin lead');
    expect(html).toContain('Linked from 2 of 2 contracts');
    expect(html).toContain('Authority not verified.');
    expect(html).toContain('Inspect this source');
    expect(html).not.toContain('Source facts verified');
  });
  it('renders an honest empty trail and optional recovery without a ruling action', () => {
    const trail = renderToStaticMarkup(<OriginResearch input={INPUT} discovery={{ notes: [], candidates: [] }} />);
    expect(trail).toContain('No usable source links');
    const html = renderToStaticMarkup(<OriginRecovery input={{ ...INPUT, source_url: '' }} />);
    expect(html).toContain('Retry automatic lookup');
    expect(html).toContain('(Optional)');
    expect(html).toContain('A supplied URL is checked');
    expect(html).toContain('method="get"');
    expect(html).not.toContain('Issue ruling');
  });
  it('escapes all provider text and keeps unsafe evidence inert', () => {
    const html = renderToStaticMarkup(<OriginResearch input={INPUT} discovery={{
      notes: ['<script>ignore evidence</script>'], candidates: [{ url: 'javascript:alert(1)', coin_cas: [], discovered_via: ['file:///etc/passwd'], status: 'needs_review', reasons: ['<img onerror="attack">'] }],
    }} />);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="file:');
    expect(html).toContain('&lt;script&gt;');
  });
});
