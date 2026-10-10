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
