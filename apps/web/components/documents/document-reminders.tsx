import { CalendarClock } from "lucide-react";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import type { DocumentReminder } from "@/lib/dal/documents";
import { expiryLabel } from "@/lib/documents/presentation";

type DocumentRemindersProps = { lang: string; reminders: DocumentReminder[]; today: string };

export function DocumentReminders({ lang, reminders, today }: DocumentRemindersProps) {
  if (reminders.length === 0) return null;
  return (
    <Card as="section" aria-labelledby="document-reminders" padding="lg" elevated className="content-start gap-4">
      <h2 id="document-reminders" className="flex items-center gap-2 text-h2">
        <CalendarClock aria-hidden className="size-4 text-warning-foreground" strokeWidth={1.75} />
        Document reminders
      </h2>
      <ul className="grid gap-2 text-body">
        {reminders.map(({ id, title, expiresOn }) => (
          <li key={id} className="flex flex-wrap items-baseline justify-between gap-x-4">
            <TextLink href={`/${lang}/passport#documents`}>{title}</TextLink>
            <span className="text-small font-medium text-warning-foreground">{expiryLabel(expiresOn, today)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
