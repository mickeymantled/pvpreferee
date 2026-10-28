import React from "react";
import type { Metadata } from "next";
import { loadRulebook, listRulebooks } from "@pvp/config";
import { ConfigView } from "../../components/config-view";

export const metadata: Metadata = { title: "The rulebook" };
export default function RulebookPage() {
  const { config, hash } = loadRulebook();
  return (
    <div className="page-stack">
      <header className="page-heading">
        <h1>The rulebook.</h1>
        <p className="lede">
          Eight checks, in order. Each ruling stores the exact
          version, thresholds, and evidence used to reach its verdict.
        </p>
      </header>
      <nav className="version-nav" aria-label="Published rulebooks"><span>Published versions</span>{listRulebooks().map(version => <a key={version} href={'/rulebook/' + version}>{version}</a>)}</nav>
      <ConfigView config={config} hash={hash} />
      <section className="content-section">
        <h2>What never changes the verdict</h2>
        <p>
          Top-holder concentration, creator launch count, developer sales, CTO
          status, dex payments, third-party badges, and bundle warnings are
          display-only. Market cap matters only through the frozen participation
          snapshot.
        </p>
        <p>
          Deployment time never breaks a tie. There is no PvP grace window, no
          price prediction, and no trading hook.
        </p>
      </section>
    </div>
  );
}
