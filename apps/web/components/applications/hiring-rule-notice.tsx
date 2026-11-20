import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { CANDIDATE_RULE_HEADINGS, FIND_LICENSED_PARTNERS, HIRING_RULES_REGION, licensedPartnersPath } from "@/lib/applications/presentation";
import type { HiringRule } from "@/lib/dal/hiring-rules";

// The direct-hiring rule of the candidate's current country for the vacancy's country (FR-Q5 AC7): the rule and its notice
// in a named region, and where it is not plainly allowed the way to licensed recruitment partners for that corridor.
export function HiringRuleNotice({ lang, hiringRule }: { lang: string; hiringRule: HiringRule }) {
  const { rule, notice, source, destination } = hiringRule;
  return (
    <section aria-label={HIRING_RULES_REGION}>
      <Notice tone={rule === "blocked" ? "warning" : "info"}>
        {rule === "allowed" ? <p>{notice}</p> : (
          <>
            <p className="font-semibold">{CANDIDATE_RULE_HEADINGS[rule]}</p>
            <p className="mt-1">{notice}</p>
          </>
        )}
        {rule === "allowed" ? null : (
          <p className="mt-2">
            <TextLink href={licensedPartnersPath(lang, source, destination)}>{FIND_LICENSED_PARTNERS}</TextLink>
          </p>
        )}
      </Notice>
    </section>
  );
}
