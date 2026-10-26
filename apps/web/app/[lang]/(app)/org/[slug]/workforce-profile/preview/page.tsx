import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { PartnerProfileView } from "@/components/partners/partner-profile-view";
import { getPartnerProfilePreview } from "@/lib/dal/partner-profile";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { partnerProfilePath, workforceProfilePath } from "@/lib/routes";

export const metadata: Metadata = { title: "Profile preview", robots: { index: false, follow: false } };

// The public profile as a member of the partner sees it (FR-K4 AC2), also while the company is in review, declined or
// hidden: the same view the public page renders, with a banner that says whether everyone sees it now. Reading it changes
// nothing, so every member may open it without two-step verification. Release 2a only.
export default async function WorkforceProfilePreviewPage({ params }: PageProps<"/[lang]/org/[slug]/workforce-profile/preview">) {
  const { lang, slug } = await params;
  if (!(await isReleased("release_partner_directories"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Profile preview" subject="details" />;
  const { profile, isPublic } = await getPartnerProfilePreview(organization.id);
  const banner = (
    <Notice tone={isPublic ? "info" : "warning"} role="status">
      {isPublic ? (
        <p>
          Preview - this is your public profile.{" "}
          <TextLink href={partnerProfilePath(lang, slug)}>Open the public page</TextLink>
        </p>
      ) : (
        <p>Preview - not public. Employers and visitors see this profile once your company is listed.</p>
      )}
      <p className="mt-2">
        <TextLink href={workforceProfilePath(lang, slug)}>Back to the workforce profile</TextLink>
      </p>
    </Notice>
  );
  return <PartnerProfileView lang={lang} profile={profile} banner={banner} />;
}
