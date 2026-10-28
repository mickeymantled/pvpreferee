import { describe, expect, it } from 'vitest';
import { createIngestFromEnv } from '../src/provider';
import { config } from './helpers';

// No fallback CAs, token-name lookup, or invented expected on-chain facts.
describe.skipIf(process.env.RUN_INTEGRATION !== '1')('live provider integration (explicit acceptance CAs only)', () => {
  for (const name of ['FIXTURE_KIMCHI_CA', 'FIXTURE_SOLCAT_CA', 'FIXTURE_ROBOTAXI_CA']) {
    it(`reads documented evidence for ${name} and honestly reports unavailable history`, async () => {
      const ca = process.env[name];
      if (!ca) throw new Error(`Set ${name}; the specification supplies no acceptance contract addresses`);
      const provider = createIngestFromEnv();
      try {
        const facts = await provider.coinFacts(ca, config);
        expect(facts.ca).toBe(ca); expect(facts.name).not.toBe(''); expect(facts.ticker).not.toBe(''); expect(facts.evidence.length).toBeGreaterThan(0);
        const snapshot = await provider.snapshotAt(ca, facts.observed_at, config);
        // The default factory deliberately has no complete mint-wide indexer.
        expect(facts.first_real_buy_at).toBeNull(); expect(snapshot.complete).toBe(false);
        expect(snapshot.mcap_usd).toBeNull(); expect(snapshot.holders).toBeNull();
      } finally { await provider.close(); }
    }, 60_000);
  }
});
