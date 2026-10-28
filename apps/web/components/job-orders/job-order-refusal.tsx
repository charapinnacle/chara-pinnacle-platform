import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import type { JobOrderRefusal } from "@/lib/dal/job-orders";
import { companyDashboardPath, workforceProfilePath } from "@/lib/routes";

const refusalTexts: Record<JobOrderRefusal, string> = {
  not_listed: "Job orders are shown to companies listed in the partner directories. Yours is not listed yet.",
  profile_hidden: "Our team hid your company profile, so job orders are not shown to your company.",
  organization_suspended: "Your company is suspended, so job orders are not shown to it.",
};

// Why the marketplace shows a company nothing (FR-N1 AC3: not listed and suspended partners are refused).
export function JobOrderRefusalNotice({ lang, slug, reason }: { lang: string; slug: string; reason: JobOrderRefusal }) {
  return (
    <Notice tone="info" role="status">
      <p>{refusalTexts[reason]}</p>
      {reason === "not_listed" ? (
        <p className="mt-2">
          <TextLink href={companyDashboardPath(lang, "recruitment", slug)}>See the review of your company</TextLink>
        </p>
      ) : reason === "profile_hidden" ? (
        <p className="mt-2">
          <TextLink href={`${workforceProfilePath(lang, slug)}#moderation-heading`}>See the decision</TextLink>
        </p>
      ) : null}
    </Notice>
  );
}
