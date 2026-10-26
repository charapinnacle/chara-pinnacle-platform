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

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

// The UTC date of an ISO date or timestamp, as 10 November 2026; undefined when the value is missing or not a date.
export function longDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(Date.parse(value))) {
    return undefined;
  }
  return dateFormat.format(new Date(value));
}
