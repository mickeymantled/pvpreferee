import React from "react";
import { ComparisonForm } from "../components/forms";

export default function HomePage() {
  return (
    <>
      <div className="home-grid">
        <section className="hero">
          <p className="eyebrow">
            <span className="live-dot" /> The court of meme origins
          </p>
          <h1>
            Same meme.
            <br />
            <span>
              Settle the
              <br className="desktop-break" /> argument.
            </span>
          </h1>
          <p className="lede">
            Two coins. Ten coins. One set of rules.
            <br />
            Find out which contract has the claim — and see the evidence behind
            every call.
          </p>
          <div className="hero-notes">
            <span>01 · Paste the contracts</span>
            <span>02 · Confirm the source</span>
            <span>03 · Share the ruling</span>
          </div>
          <a className="text-link" href="/rulebook">
            Read the rules before the ruling <span aria-hidden="true">↗</span>
          </a>
        </section>
        <div className="panel case-panel">
          <ComparisonForm />
        </div>
      </div>
      <section className="principles" aria-label="How rulings work">
        <article>
          <span className="eyebrow">Evidence first</span>
          <h2>Every call has a receipt.</h2>
          <p>
            Name, ticker, pair, endorsement. Each check points back to its
            source. Missing facts stay unknown.
          </p>
        </article>
        <article>
          <span className="eyebrow">A moment in time</span>
          <h2>Late volume doesn’t rewrite history.</h2>
          <p>
            Participation is frozen when the rival’s real buying began.
            Deployment alone is not precedence.
          </p>
        </article>
        <article>
          <span className="eyebrow">A public rulebook</span>
          <h2>No mystery score.</h2>
          <p>
            Eight checks, in order. A ranked list, a pass/fail grid, and a
            reason you can challenge.
          </p>
        </article>
      </section>
    </>
  );
}
