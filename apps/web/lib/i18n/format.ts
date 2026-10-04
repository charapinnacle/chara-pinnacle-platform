const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeZone: "UTC",
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}
