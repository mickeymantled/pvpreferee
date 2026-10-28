import { cardResponse } from "../../../../server/card";
import { findStoredRuling } from "../../../../server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  return cardResponse(slug, {
    find: findStoredRuling,
    render: async (ruling) => {
      const { renderRulingCard } = await import("@pvp/card");
      return renderRulingCard(ruling);
    },
  });
}
