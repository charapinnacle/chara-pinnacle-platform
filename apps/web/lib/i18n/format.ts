const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeZone: "UTC",
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

const legalDateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeZone: "UTC",
});

// The UTC date of a legal document version, as 1 October 2026.
export function formatLegalDate(iso: string): string {
  return legalDateFormat.format(new Date(iso));
}

const dateTimeFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "UTC",
});

export function formatDateTime(iso: string): string {
  return `${dateTimeFormat.format(new Date(iso))} UTC`;
}

// The date part of a timestamp in UTC, as 2026-11-02.
export function formatIsoDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

const shortDateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

// The form of the application dates, 3 Oct 2026 (FR-D7 AC6); every date of an application uses it.
export function formatShortDate(iso: string): string {
  return shortDateFormat.format(new Date(iso));
}

const relativeFormat = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

const relativeUnits: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

// How long ago (or ahead) a moment is, in the largest whole unit, as "2 days ago", "yesterday" or "just now"; the page
// shows the exact date next to it in a time element.
export function formatRelative(iso: string, now: Date): string {
  const seconds = (new Date(iso).getTime() - now.getTime()) / 1000;
  for (const [unit, size] of relativeUnits) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
