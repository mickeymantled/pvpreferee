import React from "react";

export function ServiceNotice({
  title = "The service is unavailable.",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <section className="panel empty-state">
      <p className="eyebrow">Unable to complete this request</p>
      <h1>{title}</h1>
      <p className="lede" role="alert">
        {message}
      </p>
      <div className="action-row">
        <a className="button primary" href="/">
          Back to comparison
        </a>
        <a className="button secondary" href="/rulebook">
          Read the rulebook
        </a>
      </div>
    </section>
  );
}
