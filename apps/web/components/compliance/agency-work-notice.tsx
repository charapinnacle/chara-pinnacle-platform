import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import type { AgencyWorkRule } from "@/lib/compliance/agency-work";
import { formatDate } from "@/lib/i18n/format";

// What a destination country's law says about leased agency work, where an employer asks a staffing company for workers.
// General information with its source, never advice; nothing is shown for a country without rules.
export function AgencyWorkNotice({ rules }: { rules: readonly AgencyWorkRule[] }) {
  if (rules.length === 0) return null;
  return (
    <Notice tone="warning" role="note" className="grid gap-3">
      <p className="font-semibold">Before you use a staffing company here</p>
      <ul className="grid gap-3">
        {rules.map((rule) => (
          <li key={rule.id} className="grid gap-1">
            <p className="font-medium">{rule.title}</p>
            <p>{rule.notice}</p>
            <p className="text-small">
              <TextLink href={rule.sourceUrl} target="_blank" rel="noopener noreferrer" prefetch={false}>
                Source<span className="sr-only"> for {rule.title} (opens in a new tab)</span>
              </TextLink>
              , checked {formatDate(rule.reviewedOn)}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-small">General information, not legal advice. Check with the authority or a lawyer before you decide.</p>
    </Notice>
  );
}
