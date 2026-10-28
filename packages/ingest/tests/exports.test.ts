import { expect, it } from 'vitest';
import * as runtime from '@pvp/ingest';
import { migrateIngest } from '@pvp/ingest/migrate';

it('exposes migration tooling only through its separate package entry point', () => {
  expect(runtime.createIngestFromEnv).toBeTypeOf('function');
  expect(runtime.createRulingRepository).toBeTypeOf('function');
  expect(runtime).not.toHaveProperty('migrateIngest');
  expect(migrateIngest).toBeTypeOf('function');
});
