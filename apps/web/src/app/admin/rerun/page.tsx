import React from 'react';
import { redirect } from 'next/navigation';
import { listRulebooks } from '@pvp/config';
import { currentAdmin } from '../../../server/security';
import { findStoredRuling } from '../../../server/services';
import { gridDiff } from '../../../server/rerun';
import { RerunForm } from '../../../components/admin-forms';
import { logout } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Re-evaluate a ruling', robots: { index: false, follow: false } };
export default async function RerunPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!await currentAdmin()) redirect('/admin/login');
  const params = await searchParams;
  let comparison: React.ReactNode = null;
  if (typeof params.before === 'string' && typeof params.after === 'string') {
    try {
      const [before, after] = await Promise.all([findStoredRuling(params.before), findStoredRuling(params.after)]);
      if (before && after) {
        const diff = gridDiff(before, after);
        comparison = <section className="content-section"><h2>Saved ruling comparison</h2>
          <p><a className="text-link" href={'/ruling/' + before.share_slug}>Original ({before.rules_version})</a> → <a className="text-link" href={'/ruling/' + after.share_slug}>New ruling ({after.rules_version})</a></p>
          <p className="muted">Historical values were re-evaluated. No fresh provider observations were made. Snapshot provenance and the original frozen payload remain available in the saved facts.</p>
          {diff.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable ruling comparison"><table className="diff-table"><caption className="sr-only">Changes between the original and new ruling</caption><thead><tr><th scope="col">Coin / check</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>{diff.map((row, i) => <tr key={i}><th scope="row">{row.coin}<br />{row.field}</th><td><pre>{JSON.stringify(row.before, null, 2)}</pre></td><td><pre>{JSON.stringify(row.after, null, 2)}</pre></td></tr>)}</tbody></table></div> : <p>No grid or verdict changes.</p>}
        </section>;
      } else comparison = <p role="alert">A comparison ruling was not found.</p>;
    } catch { comparison = <p role="alert">Saved comparison is temporarily unavailable.</p>; }
  }
  return <div className="page-stack admin-rerun"><header className="page-heading"><h1>Re-evaluate a saved ruling</h1><p className="lede">This saves a new immutable ruling from historical facts. Buyer-count or first-buy-window changes require fresh ingest.</p></header><RerunForm versions={listRulebooks()} />{comparison}<form action={logout}><button className="button secondary">Sign out</button></form></div>;
}
