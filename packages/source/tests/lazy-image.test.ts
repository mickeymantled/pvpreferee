import { expect, it, vi } from 'vitest';

vi.mock('sharp', () => { throw new Error('Native sharp is unavailable in this test.'); });

it('imports imageDistance through the public package without loading native sharp', async () => {
  const { imageDistance } = await import('../src/index.js');
  expect(imageDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
});
