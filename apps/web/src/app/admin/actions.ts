'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { InvalidInputError } from '@pvp/pipeline';
import { AccessError, adminConfig, assertSameOrigin, checkCredentials, cookieOptions, issueSession, SESSION_COOKIE } from '../../server/auth-core';
import { protectRequest, requireAdmin } from '../../server/security';
import { RateLimitError } from '../../server/rate-limit';
import { parseComparison, reviewUrl, textField } from '../../lib/input';
import { parseOverride } from '../../lib/override-form';
import type { ActionState } from '../../lib/workflow';
import { applyReviewedOverride } from '../../server/overrides';
import { withRepository } from '../../server/services';
import { rerunStoredRuling, RerunError } from '../../server/rerun';

function failure(error: unknown): ActionState {
  return { status: 'error', message: error instanceof AccessError || error instanceof RateLimitError || error instanceof InvalidInputError || error instanceof RerunError
    ? error.message : 'The request could not be saved. Check the reviewed fields and server configuration, then reload before trying again.' };
}
export async function login(_state: ActionState, form: FormData): Promise<ActionState> {
  try {
    await protectRequest('login', true);
    const config = adminConfig(process.env);
    const email = textField(form, 'email', 254);
    // Passwords are not trimmed or echoed into action state.
    const values = form.getAll('password');
    if (values.length !== 1 || typeof values[0] !== 'string' || !await checkCredentials(email, values[0], config)) throw new AccessError('Email or password is incorrect.');
    (await cookies()).set(SESSION_COOKIE, issueSession(config), cookieOptions);
  } catch (error) { return failure(error); }
  redirect('/admin/rerun');
}
export async function logout(): Promise<void> {
  assertSameOrigin(await headers(), adminConfig(process.env).origin);
  (await cookies()).set(SESSION_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  redirect('/admin/login');
}
export async function saveOverride(_state: ActionState, form: FormData): Promise<ActionState> {
  let location: string;
  try {
    await protectRequest('admin', true);
    await requireAdmin();
    const input = parseComparison(form);
    await applyReviewedOverride(input, textField(form, 'override_hash', 64), parseOverride(form));
    location = reviewUrl(input);
  } catch (error) { return failure(error); }
  redirect(location);
}
export async function rerunAction(_state: ActionState, form: FormData): Promise<ActionState> {
  let location: string;
  try {
    await protectRequest('admin', true);
    await requireAdmin();
    const slug = textField(form, 'slug', 100), version = textField(form, 'version', 24);
    const rerun = await withRepository(repository => rerunStoredRuling(slug, version, repository));
    location = '/admin/rerun?' + new URLSearchParams({ before: slug, after: rerun.share_slug });
  } catch (error) { return failure(error); }
  redirect(location);
}
