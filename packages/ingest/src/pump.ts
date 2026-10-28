import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from '@solana/addresses';
import type { LaunchFacts, LaunchProvider, Transport } from './contracts';
import { IngestError, json, mintAddress, nullableString, object, timestamp } from './common';
import { FetchTransport, JsonRpcClient } from './transport';

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const ZERO = '11111111111111111111111111111111';
const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** Read-only decoder for the documented append-only BondingCurve account. */
export function decodePumpCurve(data: Buffer): { complete: boolean; creator: string | null; quote_mint: string; fee_redirected: boolean } {
  if (data.length < 49 || !data.subarray(0, 8).equals(Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]))) throw new IngestError('INVALID_RESPONSE', 'Invalid Pump bonding curve discriminator or length');
  // Older layouts lack whole appended fields; partially present fields are corruption.
  if ((data.length > 49 && data.length < 81) || (data.length > 83 && data.length < 115)) throw new IngestError('INVALID_RESPONSE', 'Truncated Pump bonding curve');
  for (const offset of [48, 81, 82, 123, 124]) if (offset < data.length && data[offset] !== 0 && data[offset] !== 1) throw new IngestError('INVALID_RESPONSE', 'Invalid Pump boolean');
  const creator = data.length >= 81 ? getAddressDecoder().decode(data.subarray(49, 81)) : null;
  return { complete: data[48] === 1, creator: creator === ZERO ? null : creator, quote_mint: data.length >= 115 ? getAddressDecoder().decode(data.subarray(83, 115)) : ZERO, fee_redirected: data[82] === 1 || data[124] === 1 };
}
export class PumpFunAdapter implements LaunchProvider {
  constructor(private readonly rpc: JsonRpcClient, private readonly transport: Transport = new FetchTransport(), private readonly baseUrl = 'https://frontend-api-v3.pump.fun', private readonly now = () => new Date().toISOString(), private readonly verifiedQuoteAssets: Readonly<Record<string, string>> = {}) {}
  async launch(ca: string): Promise<LaunchFacts> {
    mintAddress(ca);
    const [curve] = await getProgramDerivedAddress({ programAddress: address(PUMP_PROGRAM), seeds: [Buffer.from('bonding-curve'), getAddressEncoder().encode(address(ca))] });
    const rpcRaw = await this.rpc.call('getAccountInfo', [curve, { encoding: 'base64', commitment: 'finalized' }]);
    const value = object(rpcRaw, 'Pump account response').value;
    const fetched_at = timestamp(this.now());
    const result: LaunchFacts = { launchpad: null, pair_asset: null, creator_wallet: null, fee_wallet: null, deployed_at: null, bonded_at: null, evidence: [], warnings: [], raw: [{ source: `solana:account:${curve}`, fetched_at, payload: json(rpcRaw) }] };
    if (value === null) { result.warnings.push('No Pump bonding curve account found; launchpad and pair remain unknown.'); return result; }
    const account = object(value, 'Pump curve account');
    if (account.owner !== PUMP_PROGRAM || !Array.isArray(account.data) || account.data[1] !== 'base64' || typeof account.data[0] !== 'string') throw new IngestError('INVALID_RESPONSE', 'Pump account ownership or encoding mismatch');
    const decoded = decodePumpCurve(Buffer.from(account.data[0], 'base64'));
    result.launchpad = 'pump.fun';
    result.pair_asset = [ZERO, WSOL].includes(decoded.quote_mint) ? 'SOL' : decoded.quote_mint === USDC ? 'USDC' : this.verifiedQuoteAssets[decoded.quote_mint] ?? null;
    if (result.pair_asset === null) result.warnings.push(`Quote mint ${decoded.quote_mint} has no verified canonical asset mapping; pair remains unknown.`);
    // creator is the current fee recipient in the official IDL, NOT necessarily the original creator.
    result.fee_wallet = decoded.fee_redirected ? null : decoded.creator;
    result.evidence.push(`https://solscan.io/account/${curve}`);
    if (decoded.fee_redirected) result.warnings.push('Pump fees use cashback/holder rewards; single beneficiary wallet is unknown.');
    if (decoded.complete) result.warnings.push('Curve is complete; completion time and migrated pool pairing require historical/pool evidence.');
    const url = `${this.baseUrl.replace(/\/$/, '')}/coins-v2/${ca}`;
    const response = await this.transport.request({ url, method: 'GET' });
    if (response.status === 404) { result.warnings.push('Pump public coin record unavailable; original creator and deployment time unknown.'); return result; }
    if (response.status < 200 || response.status >= 300) throw new IngestError('PROVIDER_ERROR', `Pump public API: HTTP ${response.status}`);
    const coin = object(response.body, 'Pump coin');
    if (coin.mint !== ca || (coin.bonding_curve != null && coin.bonding_curve !== curve)) throw new IngestError('INVALID_RESPONSE', 'Pump public coin identity or curve mismatch');
    result.creator_wallet = nullableString(coin.creator, 'Pump creator');
    // Public docs show a timestamp but do not specify its unit consistently; do not guess.
    result.warnings.push('Public created_timestamp is retained raw; deployment time requires a mint initialization event. Fee claimability and public beneficiary tie are not established by this adapter.');
    result.raw.push({ source: url, fetched_at, payload: json(response.body) }); result.evidence.push(url);
    return result;
  }
}
