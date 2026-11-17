import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LinkButton } from "@/components/layout/link-button";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { isReleased } from "@/lib/dal/release";
import { getCurrentUser } from "@/lib/dal/session";
import { FIND_WORKERS_PATH } from "@/lib/public/navigation";
import { findWorkersPath, loginPath } from "@/lib/routes";
import { findWorkersPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/find-workers">): Promise<Metadata> {
  const { lang } = await params;
  return (await isReleased("release_find_workers")) ? findWorkersPageMetadata(lang) : {};
}

// The Find Workers item of the public Menu (FR-Q2 AC11, FR-L5, release 2c). The search itself is on each organisation's
// own pages, for members of employers and listed recruitment and staffing companies on a paid plan; this page says what
// it is and who may use it, offers a company member the search of each of its organisations, and shows no worker.
export default async function FindWorkersPublicPage({ params }: PageProps<"/[lang]/find-workers">) {
  const { lang } = await params;
  if (!(await isReleased("release_find_workers"))) notFound();
  const user = await getCurrentUser();
  const organizations = user?.accountKind === "company" ? await getMyOrganizations(user.id) : [];
  const active = organizations.filter(({ suspended }) => !suspended);

  return (
    <ContentPage
      title="Find workers"
      lead="Employers, and recruitment and staffing companies, on a paid plan search workers who chose to be found: by occupation, the country they live in, the countries they want to work in, languages, experience and availability."
    >
      <ContentSection heading="Search workers">
        {active.length > 0 ? (
          <ul className="grid gap-3">
            {active.map((organization) => (
              <li key={organization.slug}>
                <LinkButton href={findWorkersPath(lang, organization.slug)} variant="secondary">
                  Find workers for {organization.displayName}
                </LinkButton>
              </li>
            ))}
          </ul>
        ) : user?.accountKind === "worker" ? (
          <>
            <p>Find Workers is for companies. You decide whether companies can find you.</p>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={`/${lang}/passport#find-workers`} variant="secondary">
                Find Workers in your passport
              </LinkButton>
            </div>
          </>
        ) : user ? (
          <p>Find Workers is for members of employers and of recruitment and staffing companies.</p>
        ) : (
          <>
            <p>Sign in with your company account to search workers, or see the plans that include Find Workers.</p>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={loginPath(lang, `/${lang}/${FIND_WORKERS_PATH}`)}>Sign in</LinkButton>
              <LinkButton href={`/${lang}/pricing`} variant="secondary">
                See the plans
              </LinkButton>
            </div>
          </>
        )}
      </ContentSection>
      <ContentSection heading="What a card shows">
        <p>
          Each worker appears as a card: occupation, headline, skills, years of experience, languages, availability, the country
          they live in, the countries they prefer and where they may work, and, only if the worker allows it, training,
          employment history and preferred industries.
        </p>
        <p>
          A card never shows the worker’s name, photo, email address, phone number or documents, nor the names of past
          employers. A worker can stop being found at any time.
        </p>
      </ContentSection>
      <ContentSection heading="Searching fairly">
        <p>
          Filters never use sensitive characteristics such as gender, age, nationality or religion. Searches are limited in
          number, and cards cannot be exported.
        </p>
        <p>
          Where the rules of a worker’s country do not allow direct hiring for your destination, or ask for a licensed
          partner, the card says so and points to recruitment partners.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
