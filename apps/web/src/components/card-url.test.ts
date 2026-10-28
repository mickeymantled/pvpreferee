import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cardImageUrl } from "../lib/card-url";
import { ruling } from "../test/fixtures";
import { CardPreview } from "./card-preview";
import { RulingView } from "./ruling-view";

describe("versioned card image URLs", () => {
  it("encodes the slug separately from the fixed renderer revision", () => {
    expect(cardImageUrl("case /?#&name")).toBe(
      "/api/card/case%20%2F%3F%23%26name?v=referee-logo-v1",
    );
  });

  it("requests the new renderer revision in the accessible 1200x675 preview", () => {
    const html = renderToStaticMarkup(
      React.createElement(CardPreview, { slug: "synthetic-ruling" }),
    );
    const preview = html.match(/<img\b[^>]*>/)?.[0];
    expect(preview).toContain(
      'src="/api/card/synthetic-ruling?v=referee-logo-v1"',
    );
    expect(preview).toContain('width="1200"');
    expect(preview).toContain('height="675"');
    expect(preview).toContain('alt="PvP Referee ruling summary card;');
  });

  it("uses the same revision for the ruling image link and embedded preview", () => {
    const saved = ruling();
    saved.share_slug = "synthetic-ruling";
    const before = JSON.stringify(saved);
    const html = renderToStaticMarkup(
      React.createElement(RulingView, { ruling: saved }),
    );
    expect(html).toMatch(
      /<a\b[^>]*href="\/api\/card\/synthetic-ruling\?v=referee-logo-v1"[^>]*>Open ruling image<\/a>/,
    );
    expect(html).toMatch(
      /<img\b[^>]*src="\/api\/card\/synthetic-ruling\?v=referee-logo-v1"/,
    );
    expect(html).not.toContain('"/api/card/synthetic-ruling"');
    expect(JSON.stringify(saved)).toBe(before);
  });
});
