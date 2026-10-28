"use client";

import React, { useState } from "react";

export function ShareButton({ slug }: { slug: string }) {
  const [message, setMessage] = useState("");
  const [fallback, setFallback] = useState("");
  async function share() {
    const url = new URL(
      "/ruling/" + encodeURIComponent(slug),
      window.location.origin,
    ).href;
    try {
      if (navigator.share)
        await navigator.share({ title: "PvP Referee ruling", url });
      else {
        await navigator.clipboard.writeText(url);
        setMessage("Permalink copied.");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setFallback(url);
      setMessage("Copy this permalink to share.");
    }
  }
  return (
    <div className="share-control">
      <button className="button primary" onClick={share}>
        Share ruling ↗
      </button>
      <span className="field-help" role="status">
        {message}
      </span>
      {fallback && (
        <input
          aria-label="Ruling permalink"
          value={fallback}
          readOnly
          onFocus={(event) => event.target.select()}
        />
      )}
    </div>
  );
}
