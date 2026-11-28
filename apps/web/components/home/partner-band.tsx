import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import { Band } from "@/components/public/band";
import { SectionHeading } from "@/components/public/section-heading";
import { partnerNetworkCopy as copy } from "@/lib/public/partner-network";
import { FOR_PARTNERS_PATH, RECRUITMENT_DIRECTORY_PATH, STAFFING_DIRECTORY_PATH } from "@/lib/public/navigation";
import { signUpPath } from "@/lib/routes";

// One card per type of partner, with its sign-up and its directory: on the home page and the For partners page.
export function PartnerCards({ lang }: { lang: string }) {
  const cards = [
    {
      id: "recruitment-card-heading",
      title: copy.recruitmentHeading,
      text: copy.recruitmentText,
      signUp: { href: signUpPath(lang, "recruitment_company"), label: copy.recruitmentSignUp },
      directory: { href: `/${lang}/${RECRUITMENT_DIRECTORY_PATH}`, label: copy.recruitmentBrowse },
    },
    {
      id: "staffing-card-heading",
      title: copy.staffingHeading,
      text: copy.staffingText,
      signUp: { href: signUpPath(lang, "staffing_company"), label: copy.staffingSignUp },
      directory: { href: `/${lang}/${STAFFING_DIRECTORY_PATH}`, label: copy.staffingBrowse },
    },
  ];
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
      {cards.map((card) => (
        <li key={card.id}>
          <section aria-labelledby={card.id} className="grid h-full content-start gap-4 rounded-2xl border bg-card p-6 sm:p-8">
            <h3 id={card.id} className="text-title">
              {card.title}
            </h3>
            <p className="max-w-[44ch] text-body text-pretty text-muted-foreground">{card.text}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-3">
              <LinkButton href={card.signUp.href} prefetch={false} className="h-auto min-h-11 max-w-full py-2.5 text-center whitespace-normal">
                {card.signUp.label}
              </LinkButton>
              <TextLink href={card.directory.href} prefetch={false} standalone>
                {card.directory.label}
              </TextLink>
            </div>
          </section>
        </li>
      ))}
    </ul>
  );
}

// The partner audience of the home page while release 2a is on (FR-L5), with the way to the For partners page.
export function PartnerBand({ lang }: { lang: string }) {
  return (
    <Band aria-labelledby="home-partners-heading" className="grid grid-cols-[minmax(0,1fr)] gap-10">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <SectionHeading id="home-partners-heading" eyebrow={copy.homeEyebrow} title={copy.homeHeading} />
        <TextLink href={`/${lang}/${FOR_PARTNERS_PATH}`} prefetch={false} standalone>
          {copy.forPartnersLink}
        </TextLink>
      </div>
      <PartnerCards lang={lang} />
    </Band>
  );
}
