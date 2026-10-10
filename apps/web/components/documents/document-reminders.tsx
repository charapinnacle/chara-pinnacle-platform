import { TextLink } from "@/components/forms/text-link";
import type { DocumentReminder } from "@/lib/dal/documents";
import { expiryLabel } from "@/lib/documents/presentation";

type DocumentRemindersProps = { lang: string; reminders: DocumentReminder[]; today: string };

export function DocumentReminders({ lang, reminders, today }: DocumentRemindersProps) {
  if (reminders.length === 0) return null;
  return (
    <section aria-labelledby="document-reminders" className="grid gap-3">
      <h2 id="document-reminders" className="text-h2">
        Document reminders
      </h2>
      <ul className="grid gap-1 text-body">
        {reminders.map(({ id, title, expiresOn }) => (
          <li key={id} className="flex flex-wrap items-baseline gap-x-2">
            <TextLink href={`/${lang}/passport#documents`}>{title}</TextLink>
            <span className="font-medium">{expiryLabel(expiresOn, today)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
