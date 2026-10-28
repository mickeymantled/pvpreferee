import { createHash } from 'node:crypto';
import { canonicalJson } from '@pvp/shared';
import { PublicKey } from '@solana/web3.js';
import type { Json } from './contracts';

export type IngestErrorCode = 'INVALID_INPUT' | 'PROVIDER_ERROR' | 'INVALID_RESPONSE' | 'HISTORY_UNAVAILABLE' | 'INCOMPLETE_HISTORY' | 'PRICE_UNAVAILABLE' | 'IMMUTABLE_CONFLICT';
export class IngestError extends Error {
  constructor(public readonly code: IngestErrorCode, message: string) { super(message); this.name = 'IngestError'; }
}
export function hash(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
export function timestamp(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new IngestError('INVALID_INPUT', 'Expected an ISO-8601 UTC timestamp, with at most millisecond precision');
  }
  const canonical = new Date(value).toISOString();
  if (canonical.slice(0, 19) !== value.slice(0, 19)) throw new IngestError('INVALID_INPUT', 'Invalid calendar timestamp');
  return canonical;
}
export function mintAddress(ca: string): string {
  try { if (new PublicKey(ca).toBase58() === ca) return ca; } catch { /* report without echoing input */ }
  throw new IngestError('INVALID_INPUT', 'Expected a canonical Solana mint public key');
}
export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IngestError('INVALID_RESPONSE', `${label}: expected object`);
  return value as Record<string, unknown>;
}
export function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new IngestError('INVALID_RESPONSE', `${label}: missing string`);
  return value;
}
export function nullableString(value: unknown, label: string): string | null { return value == null ? null : string(value, label); }
export function json(value: unknown): Json { return JSON.parse(JSON.stringify(value)) as Json; }
export function nonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new IngestError('INVALID_RESPONSE', `${label}: expected safe nonnegative integer`);
  return value;
}
