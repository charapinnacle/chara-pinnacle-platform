export type Payload = Record<string, unknown>;

// A template shows only the keys it names, as text; anything else in a payload, or a value of another type, is ignored.
export function field(payload: Payload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : typeof value === "number" ? String(value) : undefined;
}

// A list of objects under a key, such as the vacancies of a summary; anything else in that place is ignored.
export function items(payload: Payload, key: string): Payload[] {
  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((item): item is Payload => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
}

export function url(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/en${path}`;
}

// "worker-terms" -> "Worker terms"
export function humanize(code: string): string {
  const text = code.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
