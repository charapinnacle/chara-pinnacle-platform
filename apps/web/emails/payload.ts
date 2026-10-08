export type Payload = Record<string, unknown>;

// A template shows only the keys it names, as text; anything else in a payload, or a value of another type, is ignored.
export function field(payload: Payload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : typeof value === "number" ? String(value) : undefined;
}

export function url(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/en${path}`;
}

// "worker-terms" -> "Worker terms"
export function humanize(code: string): string {
  const text = code.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
