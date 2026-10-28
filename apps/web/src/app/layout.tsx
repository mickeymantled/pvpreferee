import React from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PvP Referee — settle the argument",
    template: "%s | PvP Referee",
  },
  description:
    "Compare competing memecoin contracts with published rules, frozen participation snapshots, and linked evidence.",
};
export const viewport: Viewport = {
  themeColor: "#101311",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <a href="/" className="brand" aria-label="PvP Referee home">
            <span className="brand-mark" aria-hidden="true">
              ↗
            </span>
            <span>
              PvP <strong>Referee</strong>
              <small>EVIDENCE OVER NOISE</small>
            </span>
          </a>
          <nav aria-label="Main navigation">
            <a href="/rulebook">
              The rulebook <span aria-hidden="true">↗</span>
            </a>
            <a className="nav-case" href="/">
              Open a case
            </a>
          </nav>
        </header>
        <main id="main" className="site-main">
          {children}
        </main>
        <footer className="site-footer">
          <span>
            PvP Referee <span className="muted">/ @pvpreferee</span>
          </span>
          <span>Rules you can read. Rulings you can replay.</span>
          <a href="/rulebook">Rulebook v1 ↗</a>
        </footer>
      </body>
    </html>
  );
}
