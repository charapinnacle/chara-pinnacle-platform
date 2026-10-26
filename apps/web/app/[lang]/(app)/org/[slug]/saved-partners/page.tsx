import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConnectionList } from "@/components/connections/connection-list";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { organizationCrumb } from "@/lib/app/navigation";
import { SAVED_PARTNERS_HEADING_ID, savedPartnerItem } from "@/lib/connections/list";
import { listSavedPartners } from "@/lib/dal/connections";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { partnerDirectoryPath } from "@/lib/partners/search-params";
import { savedPartnersPath } from "@/lib/routes";
import { parseListCursor } from "@/lib/validation/job";

export const metadata: Metadata = { title: "Saved partners", robots: { index: false } };

// The partners an employer saved (FR-L4 AC10), shared by its members, newest first. A partner that left the directory
// is not listed while its row is kept. Nothing is shown while release 2a is off.
export default async function SavedPartnersPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/saved-partners">) {
  const [{ lang, slug }, { cursor: rawCursor }] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true });
  if (organization.suspended) return <SuspendedOrganization title="Saved partners" subject="saved partners" />;

  const cursor = parseListCursor(rawCursor);
  const { partners, nextCursor } = await listSavedPartners(organization.id, cursor);

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Saved partners"
        titleProps={{ id: SAVED_PARTNERS_HEADING_ID, tabIndex: -1 }}
        description="Recruitment and staffing companies your team saved, newest first. The partners never see who saved them."
        breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Saved partners" }]} />}
      />
      <ConnectionList
        mode={{ kind: "saved", organizationId: organization.id }}
        items={partners.map((partner) => savedPartnerItem(lang, partner))}
        headingId={SAVED_PARTNERS_HEADING_ID}
        empty={{
          title: "No saved partners yet",
          description: "Save partners from their profile to find them here.",
          href: partnerDirectoryPath(lang, "recruitment"),
          label: "Find Recruitment Partners",
        }}
        nextHref={nextCursor ? savedPartnersPath(lang, slug, nextCursor) : null}
        firstHref={cursor ? savedPartnersPath(lang, slug) : null}
      />
    </div>
  );
}
