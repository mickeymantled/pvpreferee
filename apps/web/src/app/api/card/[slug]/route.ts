import { cardResponse } from "../../../../server/card";
import { findStoredRuling } from "../../../../server/services";
import { enforceRateLimit, RateLimitError } from '../../../../server/rate-limit';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try { await enforceRateLimit('card', request.headers); }
  catch (error) {
    return new Response('The image service is temporarily limited. Share the ruling permalink instead.', { status: error instanceof RateLimitError ? error.status : 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(error instanceof RateLimitError ? error.retryAfter : 60) } });
  }
  const { slug } = await context.params;
  return cardResponse(slug, {
    find: findStoredRuling,
    render: async (ruling) => {
      const { renderRulingCard } = await import("@pvp/card");
      return renderRulingCard(ruling);
    },
  });
}
