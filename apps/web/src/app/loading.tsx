import React from "react";
export default function Loading() {
  return (
    <section className="panel empty-state" role="status">
      <p className="eyebrow">PvP Referee</p>
      <h1>Loading the record…</h1>
      <p className="muted">Checking the available source and evidence.</p>
    </section>
  );
}
