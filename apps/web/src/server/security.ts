import 'server-only';
import { cookies, headers } from 'next/headers';
import { AccessError, adminConfig, appOrigin, assertSameOrigin, SESSION_COOKIE, validateSession } from './auth-core';
import { enforceRateLimit, type LimitScope } from './rate-limit';

export async function currentAdmin() {
  try { return validateSession((await cookies()).get(SESSION_COOKIE)?.value, adminConfig(process.env)); }
  catch { return null; }
}
export async function requireAdmin() {
  const auth = await currentAdmin();
  if (!auth) throw new AccessError('Administrator sign-in is required.');
  return auth;
}
export async function protectRequest(scope: LimitScope, mutation = false): Promise<void> {
  const requestHeaders = await headers();
  if (mutation) assertSameOrigin(requestHeaders, appOrigin(process.env));
  await enforceRateLimit(scope, requestHeaders);
}
