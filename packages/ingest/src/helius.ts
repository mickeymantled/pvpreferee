import type { MetadataFacts, MetadataProvider, RawEvidence } from './contracts';
import { IngestError, json, mintAddress, nullableString, object, string, timestamp } from './common';
import { JsonRpcClient } from './transport';

export class HeliusAdapter implements MetadataProvider {
  constructor(readonly rpc: JsonRpcClient, private readonly now = () => new Date().toISOString()) {}
  async metadata(ca: string): Promise<MetadataFacts> {
    mintAddress(ca);
    const [assetRaw, mintRaw] = await Promise.all([
      this.rpc.call('getAsset', { id: ca }),
      this.rpc.call('getAccountInfo', [ca, { encoding: 'jsonParsed', commitment: 'finalized' }]),
    ]);
    const asset = object(assetRaw, 'DAS asset');
    if (asset.id !== ca) throw new IngestError('INVALID_RESPONSE', 'DAS returned a different mint');
    const content = object(asset.content, 'DAS content'), metadata = object(content.metadata, 'DAS metadata');
    const account = object(object(mintRaw, 'mint RPC').value, 'mint account');
    if (!['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].includes(String(account.owner))) {
      throw new IngestError('INVALID_RESPONSE', 'Account is not owned by a supported Solana token program');
    }
    const parsed = object(object(account.data, 'parsed mint data').parsed, 'parsed mint');
    if (parsed.type !== 'mint') throw new IngestError('INVALID_RESPONSE', 'Provided address is not a token mint');
    const info = object(parsed.info, 'mint info');
    if (!('mintAuthority' in info) || !('freezeAuthority' in info)) throw new IngestError('INVALID_RESPONSE', 'Mint authority fields absent; cannot infer revoked authority');
    const links = content.links == null ? {} : object(content.links, 'DAS links');
    const at = timestamp(this.now());
    return {
      name: string(metadata.name, 'token name'), ticker: string(metadata.symbol, 'token ticker'), image_url: nullableString(links.image, 'image'),
      mint_authority: nullableString(info.mintAuthority, 'mint authority'), freeze_authority: nullableString(info.freezeAuthority, 'freeze authority'),
      evidence: [`https://solscan.io/token/${ca}`],
      raw: [{ source: 'helius:getAsset', fetched_at: at, payload: json(assetRaw) }, { source: 'helius:getAccountInfo', fetched_at: at, payload: json(mintRaw) }],
    };
  }
  /** Address activity only. DOES NOT implement HistoricalLedger or certify mint-wide completeness. */
  async addressHistoryPage(address: string, through: string, cursor: string | null = null): Promise<{ transactions: unknown[]; next_cursor: string | null; raw: RawEvidence; mint_wide_complete: false }> {
    mintAddress(address);
    const result = await this.rpc.call('getTransactionsForAddress', [address, {
      transactionDetails: 'full', sortOrder: 'asc', limit: 100, commitment: 'finalized', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1,
      ...(cursor === null ? {} : { paginationToken: cursor }),
      filters: { blockTime: { lte: Math.floor(Date.parse(timestamp(through)) / 1000) }, status: 'succeeded', tokenAccounts: 'none' },
    }]);
    const data = object(result, 'Helius history');
    if (!Array.isArray(data.data) || !('paginationToken' in data)) throw new IngestError('INVALID_RESPONSE', 'History page lacks data or pagination state');
    return { transactions: data.data, next_cursor: nullableString(data.paginationToken, 'pagination token'), mint_wide_complete: false, raw: { source: 'helius:getTransactionsForAddress', fetched_at: timestamp(this.now()), payload: json(result) } };
  }
}
