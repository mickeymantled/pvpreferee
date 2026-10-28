import type { Ruling } from '@pvp/shared';

/** The browser export has no dependency on native code, filesystem APIs or bundled assets. */
export async function renderRulingCard(_ruling: Ruling): Promise<Buffer> {
  throw new Error('@pvp/card is server-only. Render in a Node.js route or worker and send the PNG to the client.');
}
