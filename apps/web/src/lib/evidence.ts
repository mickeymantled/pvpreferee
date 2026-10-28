export function snapshotAnchor(id: string): string {
  return (
    "snapshot-" +
    Array.from(id, (char) => char.codePointAt(0)!.toString(16)).join("-")
  );
}

/** React escapes labels; this allowlist independently prevents executable hrefs. */
export function evidenceHref(value: string): string | null {
  if (value.startsWith("snapshot:") && value.length > 9)
    return "#" + snapshotAnchor(value.slice(9));
  try {
    const url = new URL(value);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* Unknown references stay readable, never clickable. */
  }
  return null;
}

export function shortCa(ca: string): string {
  return ca.length > 16 ? ca.slice(0, 6) + "…" + ca.slice(-6) : ca;
}
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "Unknown";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.length ? value.map(displayValue).join(", ") : "None recorded";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
export function utcTime(value: string | null): string {
  if (value === null) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}
