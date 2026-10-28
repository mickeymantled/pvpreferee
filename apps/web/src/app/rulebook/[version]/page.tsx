import React from 'react';
import { notFound } from 'next/navigation';
import { loadRulebook, listRulebooks } from '@pvp/config';
import { ConfigView } from '../../../components/config-view';
export function generateStaticParams() { return listRulebooks().map(version => ({ version })); }
export default async function VersionPage({ params }: { params: Promise<{ version: string }> }) {
  const { version } = await params;
  if (!listRulebooks().includes(version)) notFound();
  const { config, hash } = loadRulebook(version);
  return <div className="page-stack">
    <header className="page-heading"><h1>Rulebook {version}.</h1><p className="lede">Published rules and thresholds for this version. Every ruling preserves the configuration it used.</p></header>
    <nav className="version-nav" aria-label="Published rulebooks"><span>Published versions</span>{listRulebooks().map(item => <a key={item} href={'/rulebook/' + item} aria-current={item === version ? 'page' : undefined}>{item}</a>)}</nav>
    <ConfigView config={config} hash={hash} />
  </div>;
}
