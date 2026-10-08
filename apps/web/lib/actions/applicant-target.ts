import "server-only";
import { z } from "zod";
import { getApplicant } from "@/lib/dal/applicants";
import { requireOrgRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { slugSchema } from "@/lib/validation/team";

// The organization comes from the slug and the caller's membership and role, looked up on every call (owners and admins
// at aal2), and the application must belong to it, so that the role and the two-step check are those of the organization
// that owns the application. The plan, the status and the share are the database's rules. null for an address or an id
// that is not valid, and for an application of another organization.
export async function resolveApplicantTarget(slug: string, applicationId: string) {
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedId = z.uuid().safeParse(applicationId);
  if (!parsedSlug.success || !parsedId.success) return null;
  const { organization } = await requireOrgRole(defaultLocale, parsedSlug.data, "member", { hideFromOutsiders: true });
  const applicant = await getApplicant(parsedId.data);
  return applicant?.organizationId === organization.id ? { organization, applicationId: parsedId.data } : null;
}
