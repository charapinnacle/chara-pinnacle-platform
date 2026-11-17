import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LinkButton } from "@/components/layout/link-button";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { isReleased } from "@/lib/dal/release";
import { getCurrentUser } from "@/lib/dal/session";
import { REQUEST_WORKERS_PATH, STAFFING_DIRECTORY_PATH } from "@/lib/public/navigation";
import { loginPath } from "@/lib/routes";
import { requestWorkersPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/request-workers">): Promise<Metadata> {
  const { lang } = await params;
  return (await isReleased("release_messaging")) ? requestWorkersPageMetadata(lang) : {};
}

// The Request Workers item of the public Menu (FR-P2 step Request workforce, FR-L5 AC3 and AC10, release 2c). The request
// itself is sent from a staffing partner's profile by an employer's owner or admin; this page says what it does and leads
// to the staffing partners, so it is public and in the sitemap.
export default async function RequestWorkersPage({ params }: PageProps<"/[lang]/request-workers">) {
  const { lang } = await params;
  if (!(await isReleased("release_messaging"))) notFound();
  const user = await getCurrentUser();
  const directories = await isReleased("release_partner_directories");

  return (
    <ContentPage
      title="Request workers"
      lead="Employers ask a staffing company for workers in one request: the occupation, how many workers, where and from when. The staffing company answers in a conversation on the platform."
    >
      <ContentSection heading="How a request works">
        <ol className="grid list-decimal gap-2 ps-5">
          <li>Open the profile of a staffing company, or of a recruitment company that offers staffing.</li>
          <li>Choose Request workforce and fill in the occupation, the number of workers, the country and city, and the start date.</li>
          <li>The platform saves a private draft requirement and invites the company to it. You complete and publish it when ready.</li>
          <li>The company replies in the conversation, and responds with its offer once the requirement is published.</li>
        </ol>
        <p>Owners and administrators of an employer on a paid plan send requests. Each request counts as one message of the plan.</p>
        <div className="flex flex-wrap gap-3">
          {directories ? <LinkButton href={`/${lang}/${STAFFING_DIRECTORY_PATH}`}>Find staffing partners</LinkButton> : null}
          {user ? null : (
            <LinkButton href={loginPath(lang, `/${lang}/${REQUEST_WORKERS_PATH}`)} variant="secondary">
              Sign in
            </LinkButton>
          )}
        </div>
      </ContentSection>
      <ContentSection heading="Fair recruitment">
        <p>
          Workers never pay recruitment fees or related costs. Staffing companies on the platform committed to this, and
          requests never ask for gender, age, nationality or other personal characteristics.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
