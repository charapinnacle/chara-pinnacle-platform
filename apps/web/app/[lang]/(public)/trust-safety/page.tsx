import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { reportPath } from "@/lib/routes";
import { staticPageMetadata } from "@/lib/seo/metadata";
import { BRAND_NAME } from "@/lib/brand";

export async function generateMetadata({ params }: PageProps<"/[lang]/trust-safety">): Promise<Metadata> {
  return staticPageMetadata("trustSafety", (await params).lang);
}

export default async function TrustSafetyPage({ params }: PageProps<"/[lang]/trust-safety">) {
  const { lang } = await params;
  return (
    <ContentPage
      title="Trust & Safety"
      lead={`What you can rely on when you use ${BRAND_NAME}, as a worker or as an employer.`}
    >
      <ContentSection heading="Paying does not buy trust">
        <p>
          Paying for a plan does not make an organisation verified and does not move its vacancies up in search
          results. Every open vacancy is listed by the same rules, whatever plan its employer has.
        </p>
      </ContentSection>
      <ContentSection heading="Your documents stay private">
        <p>
          The documents you upload are private by default. An employer sees a document only when you share it with
          your application, and withdrawing the application ends the sharing. {BRAND_NAME} staff cannot open your documents.
        </p>
      </ContentSection>
      <ContentSection heading="Vacancies are moderated">
        <p>
          A vacancy that breaks our rules can be hidden from the public pages. The employer is told why and can
          appeal.
        </p>
      </ContentSection>
      <ContentSection heading="Reporting">
        <p>
          If a vacancy, a company or a page on {BRAND_NAME} is illegal, misleading or breaks our rules, tell us. You do not need an
          account, and every report gets a reference number.
        </p>
        <div className="flex flex-wrap gap-3">
          <LinkButton variant="secondary" href={reportPath(lang, "job")}>
            Report job
          </LinkButton>
          <LinkButton variant="secondary" href={reportPath(lang, "company")}>
            Report company
          </LinkButton>
          <LinkButton variant="secondary" href={reportPath(lang, "profile")}>
            Report profile
          </LinkButton>
          <LinkButton variant="secondary" href={reportPath(lang, "content")}>
            Report content
          </LinkButton>
        </div>
        <p>
          If you have an account, <TextLink href={`/${lang}/reports`}>My reports</TextLink> shows what happened to yours.
        </p>
      </ContentSection>
      <ContentSection heading="Rules and complaints">
        <p>The rules that apply to everyone, and the way to raise a complaint, are written down.</p>
        <ul className="grid gap-1">
          <li>
            <TextLink href={`/${lang}/legal/terms-of-service`}>Terms</TextLink>
          </li>
          <li>
            <TextLink href={`/${lang}/legal/platform-rules`}>Platform Rules</TextLink>
          </li>
          <li>
            <TextLink href={`/${lang}/legal/acceptable-use-policy`}>Acceptable Use Policy</TextLink>
          </li>
          <li>
            <TextLink href={`/${lang}/legal/complaints-and-dispute-process`}>Complaints and Dispute Process</TextLink>
          </li>
        </ul>
      </ContentSection>
    </ContentPage>
  );
}
