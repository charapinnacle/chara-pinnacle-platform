import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import { Band } from "@/components/public/band";
import { partnerNetworkCopy as copy } from "@/lib/public/partner-network";
import { RECRUITMENT_DIRECTORY_PATH, STAFFING_DIRECTORY_PATH } from "@/lib/public/navigation";
import { signUpPath } from "@/lib/routes";

// The partner audience of the home page while release 2a is on (FR-L5): the sign-up as either type of partner for a
// visitor, and the two directories for everyone it is shown to.
export function PartnerBand({ lang, visitor }: { lang: string; visitor: boolean }) {
  return (
    <Band aria-labelledby="home-partners-heading" className="grid gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-12">
      <div className="grid gap-4">
        <h2 id="home-partners-heading" className="max-w-[24ch] text-section text-balance">
          {copy.homeHeading}
        </h2>
        <p className="max-w-[52ch] text-body text-pretty text-muted-foreground">{copy.homeText}</p>
        <div className="flex flex-wrap gap-x-6">
          <TextLink href={`/${lang}/${RECRUITMENT_DIRECTORY_PATH}`} prefetch={false} standalone>
            {copy.recruitmentDirectory}
          </TextLink>
          <TextLink href={`/${lang}/${STAFFING_DIRECTORY_PATH}`} prefetch={false} standalone>
            {copy.staffingDirectory}
          </TextLink>
        </div>
      </div>
      {visitor ? (
        <div className="flex flex-wrap gap-3">
          <LinkButton href={signUpPath(lang, "recruitment_company")} prefetch={false}>
            {copy.recruitmentSignUp}
          </LinkButton>
          <LinkButton href={signUpPath(lang, "staffing_company")} prefetch={false} variant="secondary">
            {copy.staffingSignUp}
          </LinkButton>
        </div>
      ) : null}
    </Band>
  );
}
