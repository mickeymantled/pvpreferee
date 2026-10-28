import React from "react";
import { evidenceHref } from "../lib/evidence";

export function EvidenceLink({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  const href = evidenceHref(value);
  return href ? (
    <a
      className="evidence-link"
      href={href}
      {...(href.startsWith("#")
        ? {}
        : {
            target: "_blank",
            rel: "noopener noreferrer",
            referrerPolicy: "no-referrer" as const,
          })}
    >
      {label ?? value}
    </a>
  ) : (
    <span className="evidence-reference">
      {label ? `${label}: ${value}` : value}
    </span>
  );
}

export function EvidenceList({ values }: { values: string[] }) {
  return values.length ? (
    <ul className="evidence-list">
      {[...new Set(values)].map((value) => (
        <li key={value}>
          <EvidenceLink value={value} />
        </li>
      ))}
    </ul>
  ) : (
    <span className="muted">No evidence recorded.</span>
  );
}
