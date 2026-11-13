import { Band } from "@/components/public/band";
import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import { EMPLOYERS_PATH } from "@/lib/public/navigation";

// One calm line for an employer who arrived on the job seekers' page. Post a Job leads where the header's does and is left
// out for whom the header offers none.
export function EmployerBand({ lang, postJobHref }: { lang: string; postJobHref: string | null }) {
  return (
    <Band aria-label="For employers" className="flex flex-wrap items-center justify-between gap-x-10 gap-y-6">
      <p className="max-w-[30ch] text-title text-balance">Hiring? Publish a vacancy and manage every applicant in one pipeline.</p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {postJobHref ? (
          <LinkButton href={postJobHref} prefetch={false}>
            Post a job
          </LinkButton>
        ) : null}
        <TextLink href={`/${lang}/${EMPLOYERS_PATH}`} prefetch={false} standalone>
          For employers
        </TextLink>
      </div>
    </Band>
  );
}
