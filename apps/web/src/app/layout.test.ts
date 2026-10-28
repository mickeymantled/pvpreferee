import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import RootLayout, { metadata } from "./layout";

const logoPath = "/brand/referee-logo-v1.jpg";
const logoFile = new URL("../../public" + logoPath, import.meta.url);

function renderLayout() {
  return renderToStaticMarkup(
    React.createElement(RootLayout, { children: "Page content" }),
  );
}

describe("original referee branding", () => {
  it("serves the exact supplied JPEG bytes at a versioned public path", async () => {
    const asset = await readFile(logoFile);
    expect(createHash("sha256").update(asset).digest("hex")).toBe(
      "49bca3cde17a8bc4d5c94ddfec127dc4e7063db27dad5138b946952d21327fb1",
    );
    expect(await sharp(asset).metadata()).toMatchObject({
      format: "jpeg",
      width: 1408,
      height: 1408,
    });
  });

  it("renders the local original as a compact square without an optimizer URL", () => {
    const html = renderLayout();
    const mark = html.match(/<img\b[^>]*class="brand-mark"[^>]*>/)?.[0];
    expect(mark).toBeDefined();
    expect(mark).toContain(`src="${logoPath}"`);
    expect(mark).toContain('width="48"');
    expect(mark).toContain('height="48"');
    expect(mark).not.toContain("srcSet=");
    expect(html).not.toContain("/_next/image");
  });

  it("keeps the home link named and the adjacent logo decorative", () => {
    const html = renderLayout();
    const brand = html.match(/<a\b[^>]*class="brand"[^>]*>[\s\S]*?<\/a>/)?.[0];
    expect(brand).toContain('href="/"');
    expect(brand).toContain('aria-label="PvP Referee home"');
    expect(brand).toMatch(/<img\b[^>]*alt=""[^>]*aria-hidden="true"/);
    expect(brand).toContain("PvP <strong>Referee</strong>");
    expect(brand).not.toContain("↗");
    expect(html).toContain('href="#main"');
    expect(html).toContain('id="main"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).toContain('href="/rulebook"');
  });

  it("uses the same original JPEG for favicon metadata", () => {
    expect(metadata.icons).toEqual({
      icon: { url: logoPath, type: "image/jpeg", sizes: "1408x1408" },
    });
    expect(renderLayout()).toContain(`src="${logoPath}"`);
  });
});

describe("bundled web typography", () => {
  it.each([400, 600])("serves the licensed Inter %s face locally", async (weight) => {
    const name = `inter-latin-${weight}-normal.woff`;
    const [bundled, original, license] = await Promise.all([
      readFile(new URL(`../../public/fonts/${name}`, import.meta.url)),
      readFile(new URL(`../../../../packages/card/assets/${name}`, import.meta.url)),
      readFile(new URL("../../public/fonts/OFL.txt", import.meta.url), "utf8"),
    ]);
    expect(bundled.equals(original)).toBe(true);
    expect(bundled.subarray(0, 4).toString()).toBe("wOFF");
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(renderLayout()).toContain(`href="/fonts/${name}"`);
  });
});
