import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompanyPageView } from "@/components/companies/company-page-view";
import { ConnectionActions } from "@/components/connections/connection-actions";
import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import { PageContainer } from "@/components/layout/page-container";
import { CompanyPageSwitch } from "@/components/organization/company-page-switch";
import { hasConnectionActions } from "@/lib/connections/access";
import { getCompanyPage } from "@/lib/dal/company-page";
import { getProfileConnection } from "@/lib/dal/connections";
import { isReleased } from "@/lib/dal/release";
import { companyPagePath, organizationProfilePath, reportPath } from "@/lib/routes";
import { companyPageMetadata } from "@/lib/seo/metadata";
import { slugSchema } from "@/lib/validation/team";

// The page is read once per request (React cache) for the metadata and the page. A slug that cannot exist is not looked
// up, and nothing is read while release 2a is off.
async function loadPage(slug: string) {
  if (!slugSchema.safeParse(slug).success || !(await isReleased("release_partner_directories"))) return null;
  return getCompanyPage(slug);
}

export async function generateMetadata({ params }: PageProps<"/[lang]/companies/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  const result = await loadPage(slug);
  return result?.state === "found" ? companyPageMetadata(lang, result.page) : {};
}

// The public company page of an employer (FR-K5), rendered per request so that turning the page off, a suspension or a
// new vacancy shows at once without a cache purge (AC5). A page that is off, a suspended employer, an unknown slug and a
// switched-off release end in the same notFound() (AC1, AC6).
export default async function CompanyPage({ params }: PageProps<"/[lang]/companies/[slug]">) {
  const { lang, slug } = await params;
  const result = await loadPage(slug);
  if (!result || result.state === "not_found") notFound();
  const { page, viewer } = result;
  const path = companyPagePath(lang, page.slug);
  const connection = viewer === "outsider" ? await getProfileConnection(page.slug) : null;
  const follow =
    connection && hasConnectionActions(connection.access) ? (
      <ConnectionActions
        lang={lang}
        organizationId={connection.id}
        name={page.displayName}
        access={connection.access}
        saved={false}
        following={connection.following}
        next={path}
        visitorLabel="Sign up to follow"
      />
    ) : null;
  const actions =
    viewer === "manager" ? (
      <div className="grid gap-4">
        <LinkButton href={organizationProfilePath(lang, page.slug)}>Edit page</LinkButton>
        <div className="border-t pt-4">
          <CompanyPageSwitch slug={page.slug} enabled />
        </div>
      </div>
    ) : viewer === "outsider" ? (
      <div className="grid gap-3">
        {follow}
        <div className={follow ? "border-t pt-2" : undefined}>
          <TextLink standalone rel="nofollow" href={reportPath(lang, "content", path)}>
            Report company
          </TextLink>
        </div>
      </div>
    ) : undefined;
  return (
    <PageContainer layout="page">
      <CompanyPageView lang={lang} page={page} actions={actions} />
    </PageContainer>
  );
}
