import type { ManualOverridePatch, OverrideRequest } from '@pvp/source';
import type { MemeRecord } from '@pvp/shared';
import { InvalidInputError } from '@pvp/pipeline';
import { textField, type FormValues } from './input';

export const overrideTextFields = ['canonical_name', 'canonical_ticker', 'subject_handle', 'implied_pair', 'home_chain', 'source_launchpad', 'beneficiary_wallet', 'beneficiary_tie_at', 'source_image_url', 'source_image_hash'] as const;
export function parseOverride(form: FormValues): OverrideRequest {
  const allowed = new Set<string>(['cas', 'source_url', 'version', 'override_hash', 'reason', 'scope', 'source_tier', 'evidence', 'resolved', 'press_candidates', ...overrideTextFields]);
  if ([...form.keys()].some(key => !allowed.has(key) && !key.startsWith('$ACTION_'))) throw new InvalidInputError('Unexpected source review field. Reload the form.');
  const patch: ManualOverridePatch = {};
  for (const field of overrideTextFields) {
    const value = textField(form, field, field.includes('url') ? 2048 : 256);
    if (field === 'canonical_name' || field === 'canonical_ticker') patch[field] = value;
    else patch[field] = value || null;
  }
  patch.scope = textField(form, 'scope', 16) as MemeRecord['scope'];
  patch.source_tier = textField(form, 'source_tier', 32) as MemeRecord['source_tier'];
  patch.evidence = textField(form, 'evidence', 12000).split('\n').map(v => v.trim()).filter(Boolean);
  const resolved = textField(form, 'resolved', 5);
  if (!['true', 'false'].includes(resolved)) throw new InvalidInputError('Choose whether the source is confirmed.');
  patch.resolved = resolved === 'true';
  const press = textField(form, 'press_candidates', 16000);
  if (press) {
    try { patch.press_candidates = JSON.parse(press); }
    catch { throw new InvalidInputError('Press candidates must be a JSON array of value and articles.'); }
  }
  return { patch, reason: textField(form, 'reason', 2000) };
}
