import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConnectionActions } from "@/components/connections/connection-actions";
import { RequestWorkforce } from "@/components/connections/request-workforce";
import { SendInquiry } from "@/components/connections/send-inquiry";
import { InviteToRequirement } from "@/components/invitations/invite-to-requirement";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { LinkButton } from "@/components/layout/link-button";
import { PageContainer } from "@/components/layout/page-container";
import { PartnerProfileView } from "@/components/partners/partner-profile-view";
import { hasConnectionActions } from "@/lib/connections/access";
import { offersStaffing } from "@/lib/connections/contact-actions";
import { getContactEmployer } from "@/lib/dal/connection-actions";
import { getProfileConnection } from "@/lib/dal/connections";
import { getInviteChoices } from "@/lib/dal/invitations";
import { getPartnerProfile } from "@/lib/dal/partner-profile";
import { getCountries, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { getCurrentUser } from "@/lib/dal/session";
import { loginPath, partnerProfilePath, reportPath, workforceProfilePath } from "@/lib/routes";
import { partnerProfileMetadata } from "@/lib/seo/metadata";
import { slugSchema } from "@/lib/validation/team";

const RATE_LIMITED = "Too many requests, please try again in a minute";

// The profile is read once per request (React cache) for the metadata and the page. A slug that cannot exist is not
// looked up, and nothing is read while release 2a is off.
async function loadProfile(slug: string) {
  if (!slugSchema.safeParse(slug).success || !(await isReleased("release_partner_directories"))) return null;
  return getPartnerProfile(slug);
}

export async function generateMetadata({ params }: PageProps<"/[lang]/partners/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  const result = await loadProfile(slug);
  if (result?.state === "rate_limited") return { title: "Too many requests", robots: { index: false, follow: false } };
  return result?.state === "found" ? partnerProfileMetadata(lang, result.profile) : {};
}

// The public profile of a listed recruitment or staffing company (FR-K4), rendered per request so that a change, a
// suspension or a decline shows at once. An unknown slug, a partner that is not public and a switched-off release end in
// the same notFound() (AC2). Over the visitor limit the page says so instead of the profile (AC9).
export default async function PartnerProfilePage({ params, searchParams }: PageProps<"/[lang]/partners/[slug]">) {
  const [{ lang, slug }, { for: forParam }] = await Promise.all([params, searchParams]);
  const [result, user] = await Promise.all([loadProfile(slug), getCurrentUser()]);
  if (!result || result.state === "not_found") notFound();
  if (result.state === "rate_limited") {
    return (
      <PageContainer layout="centered">
        <AuthCard title={RATE_LIMITED} />
      </PageContainer>
    );
  }
  const { profile, viewerIsMember } = result;
  const path = partnerProfilePath(lang, profile.slug);
  // A fee demand opens the same report with its category chosen; Trust & Safety handles it first (FR-J3 AC8, FR-S1).
  const report = (
    <div className="flex flex-wrap gap-x-6">
      <TextLink standalone rel="nofollow" href={reportPath(lang, "partner_profile", profile.slug)}>
        Report company
      </TextLink>
      <TextLink standalone rel="nofollow" href={reportPath(lang, "partner_profile", profile.slug, "fee_demanded_from_worker")}>
        Report a fee demand
      </TextLink>
    </div>
  );
  const connection = viewerIsMember ? null : await getProfileConnection(profile.slug);
  const connect =
    connection && hasConnectionActions(connection.access) ? (
      <ConnectionActions
        lang={lang}
        organizationId={connection.id}
        name={profile.displayName}
        access={connection.access}
        saved={connection.saved}
        following={connection.following}
        next={path}
      />
    ) : null;
  // Invite to a requirement (FR-O1 AC12) for an owner or admin of employers with an open requirement, while release 2b
  // is on; the employer named by ?for= (a link from one of its pages) comes first.
  const preferred = typeof forParam === "string" && slugSchema.safeParse(forParam).success ? forParam : undefined;
  const choices =
    connection?.id && (await isReleased("release_job_orders")) ? await getInviteChoices([connection.id], preferred) : null;
  const invite =
    choices && connection?.id ? (
      <InviteToRequirement
        lang={lang}
        partner={{ id: connection.id, name: profile.displayName }}
        employers={choices.employers}
        invited={choices.invited[connection.id] ?? {}}
        source="profile"
      />
    ) : null;
  // Send inquiry for any member of the employer Save partner saves for, Request workforce for its owners and admins when
  // the partner offers staffing and release 2b is on too (FR-P2 AC9).
  const employer =
    connection?.id && connection.access.kind === "signed_in" ? await getContactEmployer(connection.access.saveFor) : null;
  const staffing = employer?.manager && offersStaffing(profile.type, profile.serviceTypes) && (await isReleased("release_job_orders"));
  const [occupations, countries] = staffing ? await Promise.all([getOccupations(), getCountries()]) : [[], []];
  const contact =
    employer && connection?.id ? (
      <div className="flex flex-wrap gap-3">
        <SendInquiry slug={employer.slug} employerName={employer.displayName} partnerId={connection.id} partnerName={profile.displayName} />
        {staffing ? (
          <RequestWorkforce
            slug={employer.slug}
            partnerId={connection.id}
            partnerName={profile.displayName}
            occupations={occupations.map(({ code, label }) => ({ value: code, label }))}
            countries={countries.map(({ code, name }) => ({ value: code, label: name }))}
            defaultDestination=""
          />
        ) : null}
      </div>
    ) : null;
  const actions = viewerIsMember ? (
    <LinkButton href={workforceProfilePath(lang, profile.slug)}>Edit profile</LinkButton>
  ) : user ? (
    <div className="grid gap-3">
      {contact}
      {invite}
      {connect}
      <div className={connect ? "border-t pt-2" : undefined}>{report}</div>
    </div>
  ) : (
    <div className="grid gap-3">
      <LinkButton href={loginPath(lang, path)}>Sign in to contact</LinkButton>
      {connect}
      <div className="border-t pt-2">{report}</div>
    </div>
  );
  return (
    <PageContainer layout="page">
      <PartnerProfileView lang={lang} profile={profile} actions={actions} />
    </PageContainer>
  );
}
