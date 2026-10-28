'use client';
import React, { useActionState } from 'react';
import type { MemeRecord } from '@pvp/shared';
import type { ComparisonInput } from '../lib/input';
import type { ActionState } from '../lib/workflow';
import { login, rerunAction, saveOverride } from '../app/admin/actions';
import { SourceFields } from './forms';

const initial: ActionState = { status: 'idle' };
export function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);
  return <form action={action} className="panel comparison-form">
    <label htmlFor="email">Administrator email</label><input id="email" name="email" type="email" autoComplete="username" required maxLength={254} />
    <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} />
    {state.message && <p role="alert">{state.message}</p>}
    <button className="button primary" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
  </form>;
}
export function OverrideForm({ input, previous, fingerprint }: { input: ComparisonInput; previous: MemeRecord | null; fingerprint: string }) {
  const [state, action, pending] = useActionState(saveOverride, initial);
  return <form action={action} className="panel comparison-form">
    <h2>Administrator source review</h2><p>Every changed field is saved with your administrator identity, time and reason. Review evidence before confirming.</p>
    <input type="hidden" name="cas" value={input.cas.join('\n')} /><input type="hidden" name="source_url" value={input.source_url} />
    <input type="hidden" name="version" value={input.version} /><input type="hidden" name="override_hash" value={fingerprint} />
    <SourceFields meme={previous} editable />
    <label htmlFor="evidence">Evidence URLs (one per line)</label><textarea id="evidence" name="evidence" required maxLength={12000} defaultValue={(previous?.evidence ?? [input.source_url]).join('\n')} />
    <label htmlFor="press_candidates">Press candidates (JSON array, optional)</label><textarea id="press_candidates" name="press_candidates" maxLength={16000} defaultValue={JSON.stringify(previous?.press_candidates ?? [])} />
    <label htmlFor="reason">Reason for these changes</label><textarea id="reason" name="reason" required maxLength={2000} />
    <label htmlFor="resolved">Review status</label><select id="resolved" name="resolved" defaultValue={previous?.resolved ? 'true' : 'false'}><option value="false">Needs further review</option><option value="true">Confirmed from cited sources</option></select>
    {state.message && <p role="alert">{state.message}</p>}<button className="button primary" disabled={pending}>{pending ? 'Saving review…' : 'Save audited review'}</button>
  </form>;
}
export function RerunForm({ versions }: { versions: string[] }) {
  const [state, action, pending] = useActionState(rerunAction, initial);
  return <form action={action} className="panel comparison-form">
    <label htmlFor="slug">Saved ruling slug</label><input id="slug" name="slug" required maxLength={100} pattern="[a-zA-Z0-9_-]+" />
    <label htmlFor="version">Rulebook version</label><select id="version" name="version">{versions.map(version => <option key={version}>{version}</option>)}</select>
    {state.message && <p role="alert">{state.message}</p>}<button className="button primary" disabled={pending}>{pending ? 'Re-evaluating…' : 'Save a new ruling and compare'}</button>
  </form>;
}
