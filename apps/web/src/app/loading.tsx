import React from "react";
export default function Loading() {
  return (
    <section className="empty-state" role="status">
      <h1>Loading the record…</h1>
      <p className="muted">Checking the available source and evidence.</p>
    </section>
  );
}
