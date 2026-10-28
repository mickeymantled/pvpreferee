import type { Ruling } from '@pvp/shared';
/** Wave 2 integration contract; CARD replaces this scaffold before integration. */
export async function renderRulingCard(_ruling: Ruling): Promise<Buffer> {
  throw new Error('Card renderer is pending Wave 2 implementation.');
}
