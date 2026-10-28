"use client";
import React, { useState } from "react";
import { cardImageUrl } from "../lib/card-url";

export function CardPreview({ slug }: { slug: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <section className="content-section">
      <h2>Share card</h2>
      {failed ? (
        <p className="notice">
          The card image is unavailable right now. You can still share this
          ruling’s permalink.
        </p>
      ) : (
        <img
          className="ruling-image"
          src={cardImageUrl(slug)}
          alt="PvP Referee ruling summary card; the full accessible verdict appears above"
          width={1200}
          height={675}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </section>
  );
}
