import React from 'react';
import { notFound } from 'next/navigation';
import { loadRulebook, listRulebooks } from '@pvp/config';
import { ConfigView } from '../../../components/config-view';
export function generateStaticParams() { return listRulebooks().map(version => ({ version })); }
export default async function VersionPage({ params }: { params: Promise<{ version: string }> }) {
  const { version } = await params;
  if (!listRulebooks().includes(version)) notFound();
  const { config, hash } = loadRulebook(version);
  return <div className="page-stack"><h1>Published rulebook {version}</h1><nav aria-label="Published rulebooks">{listRulebooks().map(item => <a key={item} href={'/rulebook/' + item}>{item} </a>)}</nav><ConfigView config={config} hash={hash} /></div>;
}
