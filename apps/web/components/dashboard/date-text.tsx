import { formatDate } from "@/lib/i18n/format";

export function DateText({ date }: { date: Date }) {
  return <time dateTime={date.toISOString()}>{formatDate(date.toISOString())}</time>;
}
