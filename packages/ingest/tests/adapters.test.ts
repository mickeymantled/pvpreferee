import { describe, expect, it, vi } from 'vitest';
import { getAddressEncoder } from '@solana/addresses';
import fixture from '../fixtures/providers.synthetic.json';
import type { HttpRequest, Transport } from '../src/contracts';
import { HeliusAdapter } from '../src/helius';
import { BirdeyeHistoricalPrice } from '../src/birdeye';
import { decodePumpCurve, PUMP_PROGRAM, PumpFunAdapter } from '../src/pump';
import { FetchTransport, JsonRpcClient } from '../src/transport';
import { createIngestFromEnv } from '../src/provider';
import { at, CA, config, CREATOR } from './helpers';

class SyntheticTransport implements Transport {
  requests: HttpRequest[] = [];
  constructor(private readonly handler: (r: HttpRequest) => unknown, private readonly status = 200) {}
  async request(r: HttpRequest) { this.requests.push(r); return { status: this.status, body: this.handler(r) }; }
}
function syntheticCurve() {
  const b = Buffer.alloc(150); Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]).copy(b); Buffer.from(getAddressEncoder().encode(CREATOR)).copy(b, 49); return b;
}
function syntheticRpc(r: HttpRequest) {
  const body = r.body as { method: string; params: unknown };
  if (body.method === 'getAsset') return { result: { ...fixture.das, id: CA } };
  return { result: fixture.mint };
}
describe('synthetic provider transports, never live default requests', () => {
  it('uses documented DAS metadata and parsed mint authority fields', async () => {
    const transport = new SyntheticTransport(syntheticRpc), helius = new HeliusAdapter(new JsonRpcClient('https://synthetic.invalid/rpc', transport), () => at(50));
    expect(await helius.metadata(CA)).toMatchObject({ name: 'Synthetic Cat', ticker: 'SYNTH', mint_authority: null, freeze_authority: null });
    expect(transport.requests.map(r => (r.body as { method: string }).method)).toEqual(['getAsset', 'getAccountInfo']);
  });
  it('does not confuse missing authority fields with revoked authorities', async () => {
    const mint = structuredClone(fixture.mint) as unknown as { value: { data: { parsed: { info: Record<string, unknown> } } } };
    delete mint.value.data.parsed.info.mintAuthority;
    const transport = new SyntheticTransport(r => (r.body as { method: string }).method === 'getAsset' ? syntheticRpc(r) : { result: mint });
    await expect(new HeliusAdapter(new JsonRpcClient('https://synthetic.invalid', transport)).metadata(CA)).rejects.toThrow('authority fields absent');
  });
  it('exposes Helius pagination only as address history, never complete token history', async () => {
    const transport = new SyntheticTransport(() => ({ result: { data: [], paginationToken: '100:1' } }));
    const result = await new HeliusAdapter(new JsonRpcClient('https://synthetic.invalid', transport)).addressHistoryPage(CA, at(40), '99:1');
    expect(result).toMatchObject({ mint_wide_complete: false, next_cursor: '100:1' });
    expect(transport.requests[0]!.body).toMatchObject({ params: [CA, { paginationToken: '99:1', filters: { status: 'succeeded', tokenAccounts: 'none', blockTime: { lte: Date.parse(at(40)) / 1000 } } }] });
  });
  it('reads pump launch pair and fee wallet from verified curve account, creator from HTTP', async () => {
    const b = syntheticCurve();
    const transport = new SyntheticTransport(r => r.method === 'GET' ? { ...fixture.pump, mint: CA, creator: CREATOR } : { result: { value: { owner: PUMP_PROGRAM, data: [b.toString('base64'), 'base64'] } } });
    const launch = await new PumpFunAdapter(new JsonRpcClient('https://synthetic.invalid', transport), transport, 'https://synthetic.invalid', () => at(50)).launch(CA);
    expect(launch).toMatchObject({ launchpad: 'pump.fun', pair_asset: 'SOL', creator_wallet: CREATOR, fee_wallet: CREATOR, deployed_at: null, bonded_at: null });
    expect(transport.requests[1]!.url).toBe(`https://synthetic.invalid/coins-v2/${CA}`);
    expect(launch.raw[1]!.payload).toMatchObject({ created_timestamp: fixture.pump.created_timestamp });
  });
  it('does not assume custom quotes are SOL and does not infer fee beneficiary when redirected', () => {
    const b = syntheticCurve(); Buffer.from(getAddressEncoder().encode(CA)).copy(b, 83); b[124] = 1;
    expect(decodePumpCurve(b)).toMatchObject({ quote_mint: CA, fee_redirected: true });
    expect(() => decodePumpCurve(b.subarray(0, 90))).toThrow('Truncated');
  });
  it('leaves launchpad unknown if no pump curve exists', async () => {
    const transport = new SyntheticTransport(() => ({ result: { value: null } }));
    const launch = await new PumpFunAdapter(new JsonRpcClient('https://synthetic.invalid', transport), transport).launch(CA);
    expect(launch.launchpad).toBeNull(); expect(launch.pair_asset).toBeNull(); expect(transport.requests).toHaveLength(1);
  });
  it('does not use the former bonding curve quote as the migrated pool pair', async () => {
    const b = syntheticCurve(); b[48] = 1;
    const transport = new SyntheticTransport(r => r.method === 'GET' ? { ...fixture.pump, mint: CA, creator: CREATOR } : { result: { value: { owner: PUMP_PROGRAM, data: [b.toString('base64'), 'base64'] } } });
    const launch = await new PumpFunAdapter(new JsonRpcClient('https://synthetic.invalid', transport), transport).launch(CA);
    expect(launch).toMatchObject({ launchpad: 'pump.fun', pair_asset: null });
    expect(launch.warnings.join(' ')).toContain('does not establish the migrated pool pair');
  });
  it('requests Birdeye historical checkpoint with timestamp, chain, auth and raw amount mode', async () => {
    const response = { ...fixture.birdeye, data: { ...fixture.birdeye.data, updateUnixTime: Date.parse(at(40)) / 1000 } };
    const transport = new SyntheticTransport(() => response), price = new BirdeyeHistoricalPrice('synthetic-key', transport);
    expect(await price.priceAt(CA, at(40))).toMatchObject({ price_usd: 2, observed_at: at(40) });
    const request = transport.requests[0]!;
    expect(request.headers).toMatchObject({ 'X-API-KEY': 'synthetic-key', 'x-chain': 'solana' });
    expect(new URL(request.url).pathname).toBe('/defi/historical_price_unix');
    expect(new URL(request.url).searchParams.get('unixtime')).toBe(String(Date.parse(at(40)) / 1000));
  });
  it.each([-1, 1])('rejects nearby price at offset %i seconds', async offset => {
    const transport = new SyntheticTransport(() => ({ success: true, data: { value: 2, updateUnixTime: Date.parse(at(40)) / 1000 + offset } }));
    await expect(new BirdeyeHistoricalPrice('synthetic-key', transport).priceAt(CA, at(40))).rejects.toMatchObject({ code: 'PRICE_UNAVAILABLE' });
  });
  it('rejects missing history, invalid price, scaled units, rate limits and subsecond checkpoints', async () => {
    for (const body of [{ success: true, data: null }, { success: true, data: { value: -1, updateUnixTime: Date.parse(at(40)) / 1000 } }, { success: true, data: { value: 1, updateUnixTime: Date.parse(at(40)) / 1000, isScaledUiToken: true } }]) {
      await expect(new BirdeyeHistoricalPrice('synthetic-key', new SyntheticTransport(() => body)).priceAt(CA, at(40))).rejects.toThrow();
    }
    const limited = new BirdeyeHistoricalPrice('synthetic-key', new SyntheticTransport(() => null, 429));
    await expect(limited.priceAt(CA, at(40))).rejects.toThrow('HTTP 429');
    await expect(limited.priceAt(CA, at(40.001))).rejects.toThrow('second precision');
  });
  it('factory matches pipeline signatures and explicitly returns incomplete without ledger', async () => {
    const provider = createIngestFromEnv({ env: { HELIUS_API_KEY: 'synthetic-key' }, transport: new SyntheticTransport(() => null), now: () => at(50) });
    expect(await provider.snapshotAt(CA, at(40), config)).toMatchObject({ complete: false, mcap_usd: null, holders: null });
    await provider.close();
    expect(() => createIngestFromEnv({ env: {} })).toThrow('HELIUS_API_KEY');
  });
  it('sanitizes transport failures rather than exposing credential-bearing URLs', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('synthetic secret transport failure'); });
    await expect(new FetchTransport(10).request({ method: 'GET', url: 'https://synthetic.invalid/?api-key=secret' })).rejects.toThrow('Provider request failed');
  });
});
