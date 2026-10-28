import React from "react";

export function ServiceNotice({
  title = "The service is unavailable.",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <section className="empty-state">
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
