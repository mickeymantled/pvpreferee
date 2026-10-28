"use client";
import React from "react";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="panel empty-state">
      <h1>This request could not be completed.</h1>
      <p className="lede">
        Try again. If a ruling was saved, its original permalink will preserve
        it.
      </p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
      <a className="text-link" href="/">
        Back to comparison →
      </a>
    </section>
  );
}
