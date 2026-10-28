import React from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";

const REFEREE_LOGO = "/brand/referee-logo-v1.jpg";

export const metadata: Metadata = {
  title: {
    default: "PvP Referee — settle the argument",
    template: "%s | PvP Referee",
  },
  description:
    "Compare competing memecoin contracts with published rules, frozen participation snapshots, and linked evidence.",
  icons: {
    icon: { url: REFEREE_LOGO, type: "image/jpeg", sizes: "1408x1408" },
  },
};
export const viewport: Viewport = {
  themeColor: "#080809",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/inter-latin-400-normal.woff" as="font" type="font/woff" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/inter-latin-600-normal.woff" as="font" type="font/woff" crossOrigin="anonymous" />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <a href="/" className="brand" aria-label="PvP Referee home">
            {/* The named home link supplies the accessible name for this mark. */}
            <img
              className="brand-mark"
              src={REFEREE_LOGO}
              width={48}
              height={48}
              alt=""
              aria-hidden="true"
            />
            <span>
              PvP <strong>Referee</strong>
            </span>
          </a>
          <nav aria-label="Main navigation">
            <a href="/rulebook">Rulebook</a>
            <a href="/">Open case</a>
          </nav>
        </header>
        <main id="main" className="site-main" tabIndex={-1}>
          {children}
        </main>
        <footer className="site-footer">
          <span>PvP Referee / @pvpreferee</span>
          <span>No price predictions. No trading advice.</span>
        </footer>
      </body>
    </html>
  );
}
