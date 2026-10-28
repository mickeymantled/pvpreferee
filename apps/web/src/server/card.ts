import type { Ruling } from "@pvp/shared";
import { isShareSlug } from "../lib/input";

export interface CardDependencies {
  find(slug: string): Promise<Ruling | null>;
  render(ruling: Ruling): Promise<Buffer>;
}
export async function cardResponse(
  slug: string,
  deps: CardDependencies,
): Promise<Response> {
  const errorHeaders = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!isShareSlug(slug))
    return new Response("Ruling not found.", {
      status: 404,
      headers: errorHeaders,
    });
  try {
    const ruling = await deps.find(slug);
    if (!ruling)
      return new Response("Ruling not found.", {
        status: 404,
        headers: errorHeaders,
      });
    const png = await deps.render(ruling);
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="pvp-referee-${slug}.png"`,
      },
    });
  } catch {
    return new Response(
      "The ruling image is temporarily unavailable. Share the ruling permalink instead.",
      { status: 503, headers: errorHeaders },
    );
  }
}
