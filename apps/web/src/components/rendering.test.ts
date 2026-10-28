import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RulingStatus } from "@pvp/shared";
import { evidenceHref, snapshotAnchor } from "../lib/evidence";
import { reviewFingerprint } from "../lib/workflow";
import { INPUT, resolution, ruling } from "../test/fixtures";

vi.mock("../app/actions", () => ({
  beginReview: vi.fn(),
  issueRuling: vi.fn(),
}));
import { RulingView } from "./ruling-view";
import { EvidenceLink } from "./evidence";
import { ReviewForm } from "./forms";
import HomePage from "../app/page";
import RulebookPage from "../app/rulebook/page";

function render(element: React.ReactElement) {
  return renderToStaticMarkup(element);
}
describe("honest status and evidence rendering", () => {
  it.each([
    ["resolved", "The ruling is in."],
    ["unresolved", "Evidence is incomplete."],
    ["separate_memes", "Different memes. Separate cases."],
    ["no_winner", "No winner under these rules."],
  ] satisfies [RulingStatus, string][])("renders %s", (status, text) => {
    const saved = ruling();
    saved.status = status;
    const html = render(React.createElement(RulingView, { ruling: saved }));
    expect(html).toContain(text);
    expect(html).toContain("Display-only flags");
    expect(html).toContain("never change the ruling");
    if (status !== "resolved") expect(html).not.toContain("Winning contract");
  });
  it("shows all frozen checks, thresholds, hashes and matching local snapshot anchors", () => {
    const saved = ruling();
    saved.facts.config.participation.min_distinct_buyers = 987;
    const html = render(React.createElement(RulingView, { ruling: saved }));
    saved.facts.config.rules.forEach((rule) =>
      expect(html).toContain(rule.name),
    );
    expect(html).toContain("987");
    expect(html).toContain(saved.config_hash);
    expect(html).toContain(saved.facts_hash);
    expect(html).toContain('id="' + snapshotAnchor("synthetic:one/a b") + '"');
    expect(html).toContain(
      'href="#' + snapshotAnchor("synthetic:one/a b") + '"',
    );
    expect(html).toContain("Unknown");
    expect(html).toContain("Incomplete");
    expect(html).toContain("Synthetic earlier coin was alive");
  });
  it("provides an honest local evidence target for a missing snapshot", () => {
    const saved = ruling();
    saved.facts.coins[0]!.snapshots = [];
    const html = render(React.createElement(RulingView, { ruling: saved }));
    expect(html).toContain("its payload is absent");
    expect(html).toContain('id="' + snapshotAnchor("synthetic:one/a b") + '"');
  });
  it("escapes source and audit text and refuses executable links", () => {
    const saved = ruling();
    saved.facts.meme.canonical_name = "<script>alert(1)</script>";
    saved.facts.meme.evidence = ["javascript:alert(1)"];
    const html = render(React.createElement(RulingView, { ruling: saved }));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain('href="javascript:');
  });
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>",
    "file:///etc/passwd",
    "//evil.example",
    "https://user:secret@example.com",
  ])("makes unsafe evidence inert: %s", (value) => {
    expect(evidenceHref(value)).toBeNull();
    expect(render(React.createElement(EvidenceLink, { value }))).not.toContain(
      "<a ",
    );
  });
  it("allows external HTTP(S) links with safe target attributes", () => {
    const html = render(
      React.createElement(EvidenceLink, {
        value: "https://source.example/?q=<bad>",
      }),
    );
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("<bad>");
    expect(evidenceHref("http://source.example")).toBe(
      "http://source.example/",
    );
  });
  it("keeps all canonical edit controls and an ambiguous submit disabled", () => {
    const review = {
      input: INPUT,
      resolution: { ...resolution(), needs_review: true },
      fingerprint: reviewFingerprint(INPUT, resolution()),
      ready: false,
    };
    const html = render(React.createElement(ReviewForm, { review }));
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain("Source edits are locked");
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain('name="canonical_name"');
    expect(html).not.toContain('name="meme"');
  });
  it("renders home and rulebook without any configured runtime or fake demo", () => {
    const home = render(React.createElement(HomePage)),
      rulebook = render(React.createElement(RulebookPage));
    expect(home).toContain("Review the source");
    expect(home).toContain('name="cas"');
    expect(home).toContain('name="source_url"');
    expect(home).not.toContain("synthetic-ruling");
    expect(rulebook).toContain("Config SHA-256");
    expect(rulebook).toContain("reuters.com");
  });
});
