// Bump when the card renderer changes so immutable cached images are refreshed.
const CARD_RENDERER_REVISION = "sleek-v1";

export function cardImageUrl(slug: string): string {
  return `/api/card/${encodeURIComponent(slug)}?v=${CARD_RENDERER_REVISION}`;
}
