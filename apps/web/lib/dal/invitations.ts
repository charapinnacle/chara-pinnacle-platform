import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import type { JobOrder } from "@/lib/dal/job-orders";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { getCurrentUser } from "@/lib/dal/session";
import { isFullInvitation, type InvitationStatus, type InvitationUsage } from "@/lib/invitations/presentation";
import { createClient } from "@/lib/supabase/server";

type Enums = Database["public"]["Enums"];

export const INVITATIONS_PAGE_SIZE = 20;

// One invitation in the partner's inbox, as list_my_invitations names it: the requirement's title and the employer (the
// invitation reveals it, decision 3.2); destination, workers, start date and the requirement's status only while the
// invitation is pending, accepted or responded.
export type InboxInvitation = {
  id: string;
  status: InvitationStatus;
  invitedAt: string;
  answeredAt: string | null;
  title: string;
  employerName: string;
  countryCode: string | null;
  workersNeeded: number | null;
  startDate: string | null;
  requirementStatus: Enums["requirement_status"] | null;
};

export type InboxPage = { invitations: InboxInvitation[]; nextCursor: string | null; cursorIgnored: boolean };

// One page of the partner's invitations, newest first, optionally of one status (FR-O1 AC8). A page link that names no
// invitation of the partner (made up, or of another company) shows the first page instead.
export async function listMyInvitations(
  organizationId: string,
  status: InvitationStatus | null,
  cursor: string | null,
): Promise<InboxPage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_invitations", {
    p_org: organizationId,
    p_status: status ?? undefined,
    p_cursor: cursor ?? undefined,
    p_limit: INVITATIONS_PAGE_SIZE,
  });
  if (error) {
    if (error.message === "CHARA_INVALID_INPUT" && error.details === "p_cursor" && cursor) {
      return { ...(await listMyInvitations(organizationId, status, null)), cursorIgnored: true };
    }
    throw new Error("The invitations could not be loaded", { cause: error });
  }
  return {
    invitations: data.map((row) => ({
      id: row.id,
      status: row.status,
      invitedAt: row.invited_at,
      answeredAt: row.answered_at ?? null,
      title: row.title,
      employerName: row.employer_name,
      countryCode: row.country_code ?? null,
      workersNeeded: row.workers_needed ?? null,
      startDate: row.start_date ?? null,
      requirementStatus: row.requirement_status ?? null,
    })),
    nextCursor: data.at(-1)?.next_cursor ?? null,
    cursorIgnored: false,
  };
}

const occupationsSchema = z.array(z.object({ code: z.string(), name: z.string(), quantity: z.number() })).nullable();

// One invitation of the partner with its requirement (get_invitation; the first open marks it viewed). requirement holds
// every field in the shape of a job order while the invitation is pending, accepted or responded, and is null once it is
// declined, withdrawn or expired (the title and the employer only).
export type Invitation = {
  id: string;
  status: InvitationStatus;
  invitedAt: string;
  viewedAt: string | null;
  answeredAt: string | null;
  declineReason: string | null;
  withdrawnAt: string | null;
  expiredAt: string | null;
  title: string;
  employerName: string;
  employerCompanySlug: string | null;
  requirementStatus: Enums["requirement_status"] | null;
  requirement: JobOrder | null;
};

// null for an invitation of another company or an unknown id (CHARA_NOT_FOUND), which the page answers with the
// neutral 404 (AC8).
export async function getInvitation(organizationId: string, id: string): Promise<Invitation | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invitation", { p_org: organizationId, p_invitation: id });
  if (error) {
    if (error.message === "CHARA_NOT_FOUND") return null;
    throw new Error("The invitation could not be loaded", { cause: error });
  }
  const [row] = data;
  if (!row) return null;
  const employerName = row.employer_name;
  const employerCompanySlug = row.employer_company_slug ?? null;
  return {
    id: row.id,
    status: row.status,
    invitedAt: row.invited_at,
    viewedAt: row.viewed_at ?? null,
    answeredAt: row.answered_at ?? null,
    declineReason: row.decline_reason ?? null,
    withdrawnAt: row.withdrawn_at ?? null,
    expiredAt: row.expired_at ?? null,
    title: row.title,
    employerName,
    employerCompanySlug,
    requirementStatus: row.requirement_status ?? null,
    requirement: isFullInvitation(row.status)
      ? {
          id: row.requirement_id,
          eligible: true,
          reasons: [],
          title: row.title,
          countryCode: row.country_code,
          workersNeeded: row.workers_needed,
          countries: row.countries ?? [],
          cityRegion: row.city_region ?? null,
          industryCode: row.industry_code ?? null,
          occupations: occupationsSchema.parse(row.occupations ?? null) ?? [],
          startDate: row.start_date ?? null,
          employmentType: row.employment_type ?? null,
          recruitmentPreference: row.recruitment_preference ?? null,
          publishedOn: row.published_on ?? null,
          responseCount: null,
          responsesFewerThan: null,
          employerName,
          employerCompanySlug,
          skills: row.skills ?? null,
          experienceYears: row.experience_years ?? null,
          durationMonths: row.duration_months ?? null,
          salaryMin: row.salary_min ?? null,
          salaryMax: row.salary_max ?? null,
          salaryCurrency: row.salary_currency ?? null,
          salaryPeriod: row.salary_period ?? null,
          accommodation: row.accommodation ?? null,
          workPermitSupport: row.work_permit_support ?? null,
          visaSupport: row.visa_support ?? null,
          partnerNeed: row.partner_need ?? null,
          closesOn: row.closes_on ?? null,
        }
      : null,
  };
}

const criteriaSchema = z.array(z.enum(["industry", "recruitment_type", "capacity", "available_before_start"])).nullable();
const sourceSchema = z.enum(["suggestions", "directory", "profile"]);

// One partner invited to a requirement, as the employer follows it (FR-O1 AC9): the profile slug only while the
// partner is still listed, never who invited.
export type RequirementInvitation = {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerSlug: string | null;
  partnerType: Enums["organization_type"];
  status: InvitationStatus;
  source: z.infer<typeof sourceSchema>;
  suggestionCriteria: z.infer<typeof criteriaSchema>;
  invitedAt: string;
  viewedAt: string | null;
  answeredAt: string | null;
  declineReason: string | null;
  respondedAt: string | null;
  withdrawnAt: string | null;
  expiredAt: string | null;
};

// Every invitation of a requirement of the employer, newest first. The page reads the requirement first, so any refusal
// here is an error for the route's boundary.
export async function listRequirementInvitations(organizationId: string, requirementId: string): Promise<RequirementInvitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_requirement_invitations", { p_org: organizationId, p_requirement: requirementId });
  if (error) throw new Error("The invitations of the requirement could not be loaded", { cause: error });
  return data.map((row) => ({
    id: row.id,
    partnerId: row.organization_id,
    partnerName: row.partner_name,
    partnerSlug: row.partner_slug ?? null,
    partnerType: row.partner_type,
    status: row.status,
    source: sourceSchema.parse(row.source),
    suggestionCriteria: criteriaSchema.parse(row.suggestion_criteria ?? null),
    invitedAt: row.invited_at,
    viewedAt: row.viewed_at ?? null,
    answeredAt: row.answered_at ?? null,
    declineReason: row.decline_reason ?? null,
    respondedAt: row.responded_at ?? null,
    withdrawnAt: row.withdrawn_at ?? null,
    expiredAt: row.expired_at ?? null,
  }));
}

// The invitation allowance of a requirement (FR-O1 AC9, AC12).
export async function getInvitationUsage(organizationId: string, requirementId: string): Promise<InvitationUsage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("requirement_invitation_usage", { p_org: organizationId, p_requirement: requirementId });
  if (error) throw new Error("The invitation allowance could not be loaded", { cause: error });
  const [row] = data;
  return { used: row?.used ?? 0, limit: row?.limit_value ?? null, applies: row?.applies ?? false, planName: row?.plan_name ?? null };
}

export type InviteRequirement = { id: string; title: string };

// What Invite offers a viewer on a partner profile or the saved partners (FR-O1 AC12): the employer that invites (an
// owner or admin of an employer that is not suspended: the page's own employer when it names one, otherwise the first
// one joined), its open requirements, newest first, and per partner the requirements it already has an invitation to,
// with the status. Null when the viewer invites for no employer or the employer has no open requirement.
export type InviteChoices = {
  organizationId: string;
  slug: string;
  requirements: InviteRequirement[];
  invited: Record<string, Record<string, InvitationStatus>>;
};

const INVITE_REQUIREMENTS_MAX = 50;

export async function getInviteChoices(partnerIds: readonly string[], forOrganization?: string): Promise<InviteChoices | null> {
  const user = await getCurrentUser();
  if (!user || user.suspended || user.accountKind !== "company" || partnerIds.length === 0) return null;
  const managers = (await getMyOrganizations(user.id)).filter(
    ({ type, role, suspended }) => type === "employer" && role !== "member" && !suspended,
  );
  const employer = managers.find(({ id }) => id === forOrganization) ?? managers[0];
  if (!employer) return null;
  const supabase = await createClient();
  const { data: requirements, error } = await supabase
    .from("workforce_requirements")
    .select("id, title")
    .eq("organization_id", employer.id)
    .eq("status", "open")
    .order("published_at", { ascending: false })
    .order("id")
    .limit(INVITE_REQUIREMENTS_MAX);
  if (error) throw new Error("The open requirements could not be loaded", { cause: error });
  if (requirements.length === 0) return null;
  const { data: rows, error: invitationsError } = await supabase
    .from("requirement_invitations")
    .select("requirement_id, organization_id, status")
    .eq("employer_organization_id", employer.id)
    .in("organization_id", [...partnerIds])
    .in(
      "requirement_id",
      requirements.map(({ id }) => id),
    );
  if (invitationsError) throw new Error("The invitations could not be loaded", { cause: invitationsError });
  const invited: InviteChoices["invited"] = {};
  for (const row of rows) {
    invited[row.organization_id] = { ...invited[row.organization_id], [row.requirement_id]: row.status };
  }
  return { organizationId: employer.id, slug: employer.slug, requirements, invited };
}
