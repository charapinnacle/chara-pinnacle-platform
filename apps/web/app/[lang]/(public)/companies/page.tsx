import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LinkButton } from "@/components/layout/link-button";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { isReleased } from "@/lib/dal/release";
import { getCurrentUser } from "@/lib/dal/session";
import { COMPANY_NOT_NAMED } from "@/lib/job-orders/presentation";
import { FIND_COMPANIES_PATH } from "@/lib/public/navigation";
import { findEmployersPath, loginPath, signUpPath } from "@/lib/routes";
import { findCompaniesPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/companies">): Promise<Metadata> {
  const { lang } = await params;
  return (await isReleased("release_job_orders")) ? findCompaniesPageMetadata(lang) : {};
}

// The Find Companies item of the public Menu (FR-L3 AC8, FR-L5, release 2b). The search itself is Find Employers on the
// company's own pages, for members of listed recruitment and staffing companies: a member of one such company is taken
// there (its plan decides what it sees), a member of several chooses. Everyone else reads what the search is and who may
// use it, and sees no employer and no job order.
export default async function FindCompaniesPage({ params }: PageProps<"/[lang]/companies">) {
  const { lang } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const user = await getCurrentUser();
  const organizations = user?.accountKind === "company" ? await getMyOrganizations(user.id) : [];
  const partners = organizations.filter(({ type, suspended }) => type !== "employer" && !suspended);
  if (partners.length === 1) redirect(findEmployersPath(lang, partners[0].slug));

  return (
    <ContentPage
      title="Find companies"
      lead="Recruitment and staffing companies on a paid partner plan find employers that need workers: employers with a public company page and open job orders, by destination country, industry, occupation and number of workers."
    >
      <ContentSection heading="Find employers">
        {partners.length > 1 ? (
          <ul className="grid gap-3">
            {partners.map((partner) => (
              <li key={partner.slug}>
                <LinkButton href={findEmployersPath(lang, partner.slug)} variant="secondary">
                  Find employers for <span className="normal-case">{partner.displayName}</span>
                </LinkButton>
              </li>
            ))}
          </ul>
        ) : user ? (
          <p>Find Employers is for recruitment and staffing companies listed in the partner directories.</p>
        ) : (
          <>
            <p>Sign in with your recruitment or staffing company to find employers, or register your company.</p>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={loginPath(lang, `/${lang}/${FIND_COMPANIES_PATH}`)}>Sign in</LinkButton>
              <LinkButton href={signUpPath(lang, "company")} variant="secondary" className="h-auto min-h-11 max-w-full py-2.5 text-center whitespace-normal">
                Sign up as a recruitment or staffing company
              </LinkButton>
            </div>
          </>
        )}
      </ContentSection>
      <ContentSection heading="What the search shows">
        <p>
          Employers that publish a company page, with their public vacancies, and the open job orders that fit the countries
          a company serves and the occupations it lists. Destination and industry filters come with every paid partner plan;
          occupation, number of workers and saved searches with Professional and Enterprise.
        </p>
        <p>Results are ordered by the latest activity of each employer, newest first. No employer pays to appear higher.</p>
      </ContentSection>
      <ContentSection heading="Employers that are not named">
        <p>
          An employer may publish a job order without its name. The job order is then listed on its own as “{COMPANY_NOT_NAMED}”,
          with the industry and the destination, and never next to the employer’s company page.
        </p>
        <p>Companies contact employers only by responding to a job order, never by email or phone from the search.</p>
      </ContentSection>
    </ContentPage>
  );
}
