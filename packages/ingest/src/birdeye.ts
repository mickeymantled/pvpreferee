import type { HistoricalPrice, HistoricalPriceProvider, Transport } from './contracts';
import { IngestError, json, mintAddress, nonnegativeInteger, object, timestamp } from './common';
import { FetchTransport, requestJson } from './transport';

export class BirdeyeHistoricalPrice implements HistoricalPriceProvider {
  constructor(private readonly apiKey: string, private readonly transport: Transport = new FetchTransport(), private readonly baseUrl = 'https://public-api.birdeye.so', private readonly now = () => new Date().toISOString()) {}
  async priceAt(ca: string, at: string): Promise<HistoricalPrice> {
    mintAddress(ca); const requested = timestamp(at), seconds = Date.parse(requested) / 1000;
    if (!Number.isSafeInteger(seconds)) throw new IngestError('PRICE_UNAVAILABLE', 'Birdeye has second precision; cannot certify a subsecond checkpoint');
    if (!this.apiKey) throw new IngestError('PRICE_UNAVAILABLE', 'BIRDEYE_API_KEY is required for historical valuation');
    const url = new URL('/defi/historical_price_unix', this.baseUrl);
    url.searchParams.set('address', ca); url.searchParams.set('unixtime', String(seconds)); url.searchParams.set('ui_amount_mode', 'raw');
    const body = await requestJson(this.transport, { url: url.toString(), method: 'GET', headers: { 'X-API-KEY': this.apiKey, 'x-chain': 'solana', accept: 'application/json' } }, 'Birdeye historical price');
    const response = object(body, 'Birdeye response');
    if (response.success !== true || response.data === null) throw new IngestError('PRICE_UNAVAILABLE', 'Birdeye has no historical price for this checkpoint');
    const data = object(response.data, 'Birdeye historical data');
    const observed = nonnegativeInteger(data.updateUnixTime, 'price updateUnixTime');
    // The provider documents a NEARBY matched price record. Do not mislabel it exact.
    if (observed !== seconds) throw new IngestError('PRICE_UNAVAILABLE', 'Birdeye returned a nearby price rather than the exact checkpoint; no stale/future price fallback is permitted');
    if (typeof data.value !== 'number' || !Number.isFinite(data.value) || data.value < 0) throw new IngestError('INVALID_RESPONSE', 'Birdeye returned an invalid price');
    if (data.isScaledUiToken === true) throw new IngestError('PRICE_UNAVAILABLE', 'Scaled UI tokens require an extension-aware historical supply/price adapter');
    return { mint: ca, requested_at: requested, observed_at: new Date(observed * 1000).toISOString(), price_usd: data.value, evidence: [url.toString()], raw: { source: url.toString(), fetched_at: timestamp(this.now()), payload: json(body) } };
  }
}
