import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { isReleased } from "@/lib/dal/release";
import { getCurrentUser } from "@/lib/dal/session";
import { COMPANY_NOT_NAMED } from "@/lib/job-orders/presentation";
import { jobOrdersPath, loginPath, requirementsPath, signUpPath } from "@/lib/routes";
import { jobOrdersPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/job-orders">): Promise<Metadata> {
  const { lang } = await params;
  return (await isReleased("release_job_orders")) ? jobOrdersPageMetadata(lang) : {};
}

// The Job Orders item of the public Menu (FR-L5, release 2b): what job orders are and who sees them, with the way in for
// each visitor. The job orders themselves are read only by members of listed partners on their company's page (FR-N1),
// so this page shows none of them and no figure. Nothing exists while release 2b is off.
export default async function JobOrdersInfoPage({ params }: PageProps<"/[lang]/job-orders">) {
  const { lang } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const user = await getCurrentUser();
  const organizations = user?.accountKind === "company" ? await getMyOrganizations(user.id) : [];
  const partners = organizations.filter(({ type, suspended }) => type !== "employer" && !suspended);
  const employer = organizations.find(({ type, suspended }) => type === "employer" && !suspended);

  return (
    <ContentPage
      title="Job orders"
      lead="Employers publish their workforce requirements as job orders, such as “Germany, 100 welders”, for recruitment and staffing companies that can supply the workers."
    >
      <ContentSection heading="Find job orders">
        {partners.length > 0 ? (
          <ul className="grid gap-3">
            {partners.map((partner) => (
              <li key={partner.slug}>
                <LinkButton href={jobOrdersPath(lang, partner.slug)} variant={partners.length === 1 ? "primary" : "secondary"}>
                  Job orders for {partner.displayName}
                </LinkButton>
              </li>
            ))}
          </ul>
        ) : employer ? (
          <p>
            Your company publishes job orders from its{" "}
            <TextLink href={requirementsPath(lang, employer.slug)}>workforce requirements</TextLink>: choose the job order
            marketplace when you publish one.
          </p>
        ) : user ? (
          <p>Job orders are for recruitment and staffing companies listed in the partner directories.</p>
        ) : (
          <>
            <p>Sign in with your recruitment or staffing company to see the job orders, or register your company.</p>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={loginPath(lang, `/${lang}/job-orders`)}>Sign in</LinkButton>
              <LinkButton href={signUpPath(lang, "recruitment_company")} variant="secondary">
                Sign up as a recruitment company
              </LinkButton>
              <LinkButton href={signUpPath(lang, "staffing_company")} variant="secondary">
                Sign up as a staffing company
              </LinkButton>
            </div>
          </>
        )}
      </ContentSection>
      <ContentSection heading="Who sees a job order">
        <p>
          Companies listed in the partner directories see every open job order. Those on a paid partner plan that serve its
          destination and list one of its occupations see it in full; the others see its title, destination and number of
          workers, with what to add to their profile.
        </p>
        <p>Job orders are newest first. No company pays to see a job order earlier or higher in the list.</p>
      </ContentSection>
      <ContentSection heading="The employer’s name">
        <p>
          The employer chooses whether its name is shown. Otherwise the job order says “{COMPANY_NOT_NAMED}”, with the
          industry and the destination, until the employer invites a company or shortlists its response.
        </p>
      </ContentSection>
      <ContentSection heading="New job orders by email">
        <p>
          Owners and administrators of a listed company can switch on “New job orders that fit” in their notification
          settings: one email for each new job order their company sees in full, up to a daily limit.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
