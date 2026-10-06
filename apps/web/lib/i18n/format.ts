const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeZone: "UTC",
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
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
