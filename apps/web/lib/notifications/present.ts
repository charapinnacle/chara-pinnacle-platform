import type { Database } from "@chara-pinnacle/db-types";
import { applicationStatusLabels } from "@/lib/applications/presentation";
import { employerSubmissionLabels, isPipelineSubmissionStage } from "@/lib/submissions/presentation";
import { formatDate } from "@/lib/i18n/format";
import { changedFieldsText } from "@/lib/requirements/change-fields";
import {
  appealPath,
  applicantPath,
  applicationPath,
  billingPath,
  companyPagePath,
  dataExportPath,
  employerDashboardPath,
  findWorkersCardPath,
  homePath,
  invitationPath,
  jobOrderPath,
  jobPath,
  mfaPath,
  myReportsPath,
  partnerSubmissionsPath,
  requirementPath,
  requirementResponsesPath,
  requirementSubmissionsPath,
  responsePath,
  settingsPath,
  submissionPath,
  workforceProfilePath,
} from "@/lib/routes";
import { infoStepLabels, infoStepSchema } from "@/lib/validation/partner-review";

type AccountKind = Database["public"]["Enums"]["account_kind"];
type ApplicationStatus = Database["public"]["Enums"]["application_status"];

export const NOTIFICATIONS_PAGE_SIZE = 20;

export type NotificationItem = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

// What a list item shows: one sentence, a short name of the kind and the page of its context (null when there is none).
export type PresentedNotification = {
  title: string;
  kindLabel: string;
  href: string | null;
  // A second page the item offers after its title, such as the complaint route of a dismissed report.
  secondary?: { lead: string; label: string; href: string };
};

type Context = { lang: string; accountKind: AccountKind | null };

// The list shows only the keys it names, as text, like the email templates.
function text(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : typeof value === "number" ? String(value) : undefined;
}

function countOf(count: number, one: string, other: string): string {
  return `${count} ${count === 1 ? one : other}`;
}

function documentName(slug: string): string {
  const name = slug.replace(/[-_]+/g, " ").trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function isApplicationStatus(value: string | undefined): value is ApplicationStatus {
  return value !== undefined && Object.hasOwn(applicationStatusLabels, value);
}

// The moderation decision a notice names, which its appeal page is addressed by.
function decisionId(payload: Record<string, unknown>): number | null {
  const value = payload.moderation_action_id;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

// A hidden or unhidden job order, response or submission of the recipient's organisation (V57): its kind as the
// organisation calls it, its title as the organisation knows it, and the page where it reads the decision.
const moderatedItemKinds: Record<string, string> = {
  requirement: "requirement",
  partner_response: "response to",
  candidate_submission: "candidate submission for",
};

function moderatedItem(payload: Record<string, unknown>, lang: string, slug: string | undefined) {
  const type = text(payload, "target_type");
  const id = text(payload, "target_id");
  const kind = type ? moderatedItemKinds[type] : undefined;
  if (!type || !kind) return null;
  const href =
    !slug || !id
      ? null
      : type === "requirement"
        ? requirementPath(lang, slug, id)
        : type === "partner_response"
          ? responsePath(lang, slug, id)
          : partnerSubmissionsPath(lang, slug);
  return { kind, title: text(payload, "title") ?? "a job order", href };
}

// The requirement a closing reminder names, on the page of the recipient's organisation.
function closingRequirementPath(lang: string, payload: Record<string, unknown>): string | null {
  const slug = text(payload, "org_slug");
  const id = text(payload, "requirement_id");
  return slug && id && /^[0-9a-f-]{36}$/.test(id) ? requirementPath(lang, slug, id) : null;
}

function invitationHref(lang: string, payload: Record<string, unknown>): string | null {
  const slug = text(payload, "org_slug");
  const id = text(payload, "invitation_id");
  return slug && id && /^[0-9a-f-]{36}$/.test(id) ? invitationPath(lang, slug, id) : null;
}

// A partner's notice about a requirement it responded to on the marketplace names its response (V44), not an invitation.
function responseHref(lang: string, payload: Record<string, unknown>): string | null {
  const slug = text(payload, "org_slug");
  const id = text(payload, "response_id");
  return slug && id && /^[0-9a-f-]{36}$/.test(id) ? responsePath(lang, slug, id) : null;
}

// The responses of the requirement a response notice names, on the employer's page (FR-T1 AC8).
function requirementResponsesHref(lang: string, payload: Record<string, unknown>): string | null {
  const slug = text(payload, "org_slug");
  const id = text(payload, "requirement_id");
  return slug && id && /^[0-9a-f-]{36}$/.test(id) ? requirementResponsesPath(lang, slug, id) : null;
}

// The candidates of the requirement a submission notice names, on the recipient organisation's page (FR-O4).
function requirementSubmissionsHref(lang: string, payload: Record<string, unknown>): string | null {
  const slug = text(payload, "org_slug");
  const id = text(payload, "requirement_id");
  return slug && id && /^[0-9a-f-]{36}$/.test(id) ? requirementSubmissionsPath(lang, slug, id) : null;
}

function proposedCandidate(payload: Record<string, unknown>): string {
  return payload.to_partner === true ? "A candidate you proposed" : `A candidate proposed by ${text(payload, "partner_name") ?? "a partner"}`;
}

function licencePath(lang: string, payload: Record<string, unknown>): string | null {
  const slug = text(payload, "org_slug");
  return slug ? `${workforceProfilePath(lang, slug)}#licences-heading` : null;
}

// A presenter names its own kindLabel when the kind is filed by what it is about, as a change to a requirement is filed
// with the recipient's response once there is one, and with the invitation otherwise.
type Presenter = (
  payload: Record<string, unknown>,
  context: Context,
) => Omit<PresentedNotification, "kindLabel"> & { kindLabel?: string };

const PRESENTERS: Record<string, { label: string; present: Presenter }> = {
  application_received: {
    label: "New application",
    present: (payload, { lang }) => {
      const slug = text(payload, "org_slug");
      const id = text(payload, "application_id");
      return {
        title: `New application for ${text(payload, "job_title") ?? "your vacancy"}`,
        href: slug && id ? applicantPath(lang, slug, id) : null,
      };
    },
  },
  status_changed: {
    label: "Application update",
    present: (payload, { lang }) => {
      const status = text(payload, "status");
      const job = text(payload, "job_title") ?? "your application";
      const id = text(payload, "application_id");
      // FR-O5 AC9: a submission's stage, named by the partner that proposed the candidate.
      const submissionId = text(payload, "submission_id");
      if (submissionId) {
        const partner = text(payload, "partner_name") ?? "a recruitment company";
        return {
          title: isPipelineSubmissionStage(status)
            ? `Your submission by ${partner} for ${job} is now ${employerSubmissionLabels[status]}`
            : `There is an update on your submission by ${partner} for ${job}`,
          href: /^[0-9a-f-]{36}$/.test(submissionId) ? submissionPath(lang, submissionId) : null,
        };
      }
      return {
        title:
          status === "withdrawn"
            ? `You withdrew your application for ${job}`
            : isApplicationStatus(status)
              ? `Your application for ${job} is now ${applicationStatusLabels[status]}`
              : `There is an update on your application for ${job}`,
        href: id ? applicationPath(lang, id) : null,
      };
    },
  },
  vacancy_hidden: {
    label: "Moderation",
    present: (payload, { lang }) => {
      const slug = text(payload, "org_slug");
      const id = text(payload, "job_id");
      return {
        title: `${text(payload, "job_title") ?? "A vacancy"} was hidden by moderation`,
        href: slug && id ? jobPath(lang, slug, id) : null,
      };
    },
  },
  trial_ending: {
    label: "Billing",
    present: (payload, { lang }) => {
      const slug = text(payload, "org_slug");
      const ends = text(payload, "trial_ends_at");
      return {
        title: ends ? `Your trial ends on ${formatDate(ends)}` : "Your trial ends soon",
        href: slug ? billingPath(lang, slug) : null,
      };
    },
  },
  payment_failed: {
    label: "Billing",
    present: (payload, { lang }) => {
      const slug = text(payload, "org_slug");
      return { title: "A payment for your subscription failed", href: slug ? billingPath(lang, slug) : null };
    },
  },
  legal_version: {
    label: "Legal",
    present: (payload, { lang }) => {
      const slug = text(payload, "document_slug");
      return {
        title: slug ? `New version of the ${documentName(slug)}` : "A legal document has a new version",
        href: slug ? `/${lang}/legal/${encodeURIComponent(slug)}` : null,
      };
    },
  },
  mfa_reset: {
    label: "Security",
    present: (_payload, { lang }) => ({ title: "Your two-step verification was reset", href: mfaPath(lang) }),
  },
  deletion_requested: {
    label: "Account",
    present: (payload, { lang }) => {
      const on = text(payload, "erases_on");
      return {
        title: on ? `Your account will be deleted on ${formatDate(on)}` : "Your account is set to be deleted",
        href: settingsPath(lang),
      };
    },
  },
  // An organisation suspended while release 2a is on is led to the decision and its appeal (FR-S1).
  account_suspended: {
    label: "Account",
    present: (payload, { lang }) => {
      const decision = decisionId(payload);
      const org = text(payload, "org_name");
      return decision
        ? { title: `${org ?? "Your organisation"} was suspended`, href: appealPath(lang, decision) }
        : { title: "Your account was suspended", href: `/${lang}/suspended` };
    },
  },
  account_reinstated: {
    label: "Account",
    present: (_payload, { lang, accountKind }) => ({ title: "Your account was reinstated", href: homePath(lang, accountKind) }),
  },
  account_exists: {
    label: "Security",
    present: () => ({ title: "Someone tried to sign up with your email address", href: null }),
  },
  partner_approved: {
    label: "Partner review",
    present: (payload, { lang }) => ({
      title: `${text(payload, "org_name") ?? "Your company"} is now listed in the partner directories`,
      href: employerDashboardPath(lang),
    }),
  },
  partner_info_requested: {
    label: "Partner review",
    present: (payload, { lang }) => {
      const step = infoStepSchema.safeParse(payload.info_step);
      return {
        title: step.success
          ? `Our team needs more information about ${infoStepLabels[step.data]}`
          : "Our team needs more information about your company",
        // The dashboard shows the team's message with the way back to onboarding; the reopened step page does not show it.
        href: employerDashboardPath(lang),
      };
    },
  },
  partner_declined: {
    label: "Partner review",
    present: (payload, { lang }) => ({
      title: `${text(payload, "org_name") ?? "Your company"} was not listed in the partner directories`,
      href: employerDashboardPath(lang),
    }),
  },
  licence_expiring: {
    label: "Licences",
    present: (payload, { lang }) => {
      const country = text(payload, "country_name");
      const value = text(payload, "valid_until");
      const until = value && !Number.isNaN(Date.parse(value)) ? value : undefined;
      return {
        title: `Your licence${country ? ` for ${country}` : ""} expires ${until ? `on ${formatDate(until)}` : "soon"}`,
        href: licencePath(lang, payload),
      };
    },
  },
  partner_licence_expired: {
    label: "Licences",
    present: (payload, { lang }) => {
      const country = text(payload, "country_name");
      return { title: `Your licence${country ? ` for ${country}` : ""} has expired`, href: licencePath(lang, payload) };
    },
  },
  listing_confirmation_due: {
    label: "Availability",
    present: (payload, { lang }) => {
      const total = Number(text(payload, "total"));
      const slug = text(payload, "org_slug");
      return {
        title:
          total === 1
            ? "1 availability listing needs confirming"
            : total > 1
              ? `${total} availability listings need confirming`
              : "Some availability listings need confirming",
        href: slug ? `${workforceProfilePath(lang, slug)}#availability-heading` : null,
      };
    },
  },
  // V54: the digest also names the company's new named job orders; one job order alone links a partner follower to its
  // job order page, everything else the company page (a candidate never gets a job order link, decision 3.1).
  followed_company_activity: {
    label: "Followed companies",
    present: (payload, { lang }) => {
      const org = text(payload, "org_name") ?? "A company you follow";
      const total = Number(text(payload, "total")) || 0;
      const vacancies = Array.isArray(payload.vacancies) ? (payload.vacancies as Record<string, unknown>[]) : [];
      const first = vacancies[0] ? text(vacancies[0], "job_title") : undefined;
      const jobOrderTotal = Number(text(payload, "job_order_total")) || 0;
      const jobOrders = Array.isArray(payload.job_orders) ? (payload.job_orders as Record<string, unknown>[]) : [];
      const firstJobOrder = jobOrders[0] ? text(jobOrders[0], "title") : undefined;
      const jobOrderId = jobOrders[0] ? text(jobOrders[0], "requirement_id") : undefined;
      const slug = text(payload, "org_slug");
      const partnerSlug = text(payload, "partner_slug");
      const companyHref = slug ? companyPagePath(lang, slug) : null;
      if (jobOrderTotal > 0 && total > 0) {
        return {
          title: `${org} published ${countOf(total, "new vacancy", "new vacancies")} and ${countOf(jobOrderTotal, "new job order", "new job orders")}`,
          href: companyHref,
        };
      }
      if (jobOrderTotal > 0) {
        const one = jobOrderTotal === 1;
        return {
          title: one && firstJobOrder ? `${org} published a new job order: ${firstJobOrder}` : `${org} published ${jobOrderTotal} new job orders`,
          href:
            one && partnerSlug && jobOrderId && /^[0-9a-f-]{36}$/.test(jobOrderId) ? jobOrderPath(lang, partnerSlug, jobOrderId) : companyHref,
        };
      }
      return {
        title:
          total === 1 && first
            ? `${org} published a new vacancy: ${first}`
            : total > 1
              ? `${org} published ${total} new vacancies`
              : `${org} published new vacancies`,
        href: companyHref,
      };
    },
  },
  // The affected company reads the decision on its profile; a reporter reads the outcome of the report (FR-S1 step Inform);
  // the appellant reads the outcome of the appeal on the decision page (step Appeal).
  moderation_decision: {
    label: "Moderation",
    present: (payload, { lang }) => {
      const reference = text(payload, "reference");
      if (reference) {
        return {
          title: `Your report ${reference} was closed`,
          href: myReportsPath(lang),
          // A reporter may contest a decision not to act (DSA Art. 20); until it is decided how, the route is the
          // Complaints and Dispute Process (OPEN_QUESTIONS.md L12).
          ...(text(payload, "outcome") === "dismissed"
            ? { secondary: { lead: "If you disagree with this outcome, see the", label: "Complaints and Dispute Process", href: `/${lang}/legal/complaints-and-dispute-process` } }
            : {}),
        };
      }
      const outcome = text(payload, "appeal_outcome");
      if (outcome) {
        const decision = decisionId(payload);
        const about = text(payload, "title");
        return {
          title: `${about ? `Your appeal about ${about}` : "Your appeal"} was decided: ${outcome === "restored" ? "the decision was reversed" : "the decision was upheld"}`,
          href: decision ? appealPath(lang, decision) : null,
        };
      }
      const slug = text(payload, "org_slug");
      const unhidden = text(payload, "decision") === "unhide";
      const item = moderatedItem(payload, lang, slug);
      if (item) {
        return {
          title: unhidden ? `Your ${item.kind} ${item.title} is shown again` : `Your ${item.kind} ${item.title} was hidden by moderation`,
          href: item.href,
        };
      }
      const title = text(payload, "title") ?? "Your partner profile";
      return {
        title: unhidden ? `${title} is shown again` : `${title} was hidden by moderation`,
        href: slug ? `${workforceProfilePath(lang, slug)}${unhidden ? "" : "#moderation-heading"}` : null,
      };
    },
  },
  // A partner's reminder names its invitation (V43) and links there; the employer's links to the requirement to extend it.
  requirement_closing_soon: {
    label: "Workforce requirements",
    present: (payload, { lang }) => {
      const title = text(payload, "title");
      const value = text(payload, "closes_on");
      const closes = value && !Number.isNaN(Date.parse(value)) ? formatDate(value) : undefined;
      return {
        title: `${title ? `"${title}"` : "A workforce requirement"} closes ${closes ? `on ${closes}` : "soon"}`,
        href: text(payload, "invitation_id")
          ? invitationHref(lang, payload)
          : text(payload, "response_id")
            ? responseHref(lang, payload)
            : closingRequirementPath(lang, payload),
      };
    },
  },
  // FR-M2 step Edit: the fields, never their values; the link lands on the changes of the invitation or response page.
  requirement_changed: {
    label: "Invitations",
    present: (payload, { lang }) => {
      const title = text(payload, "title");
      const employer = text(payload, "employer_name");
      const fields = changedFieldsText(payload.changed_fields);
      const responded = text(payload, "response_id") !== undefined;
      const href = responded ? responseHref(lang, payload) : invitationHref(lang, payload);
      return {
        title: `${employer ?? "The employer"} changed ${title ? `"${title}"` : "a workforce requirement"}${fields ? `: ${fields}` : ""}`,
        href: href ? `${href}#changes` : null,
        ...(responded ? { kindLabel: "Responses" } : {}),
      };
    },
  },
  requirement_closed: {
    label: "Invitations",
    present: (payload, { lang }) => {
      const title = text(payload, "title");
      const responded = text(payload, "response_id") !== undefined;
      const subject = title ? `"${title}"` : `A workforce requirement you ${responded ? "responded to" : "are invited to"}`;
      return {
        title: `${subject} ${text(payload, "close_reason") === "filled" ? "is filled" : "is closed"}`,
        href: responded ? responseHref(lang, payload) : invitationHref(lang, payload),
        ...(responded ? { kindLabel: "Responses" } : {}),
      };
    },
  },
  // NFR-S11: the generated title and the destination, never the employer; the link is the recipient's own company page.
  job_order_match: {
    label: "Job orders",
    present: (payload, { lang }) => {
      const title = text(payload, "title");
      const slug = text(payload, "org_slug");
      const id = text(payload, "requirement_id");
      return {
        title: title ? `New job order: ${title}` : "A new job order fits your company",
        href: slug && id && /^[0-9a-f-]{36}$/.test(id) ? jobOrderPath(lang, slug, id) : null,
      };
    },
  },
  // The invitation reveals the employer to the invited partner (decision 3.2), so the item names it with the requirement's
  // title; the link is the recipient's own invitation page.
  invitation_received: {
    label: "Invitations",
    present: (payload, { lang }) => {
      const title = text(payload, "title");
      const employer = text(payload, "employer_name");
      return {
        title: `${employer ?? "An employer"} invited your company to ${title ? `"${title}"` : "a workforce requirement"}`,
        href: invitationHref(lang, payload),
      };
    },
  },
  invitation_withdrawn: {
    label: "Invitations",
    present: (payload, { lang }) => {
      const title = text(payload, "title");
      const employer = text(payload, "employer_name");
      return {
        title: `${employer ?? "The employer"} withdrew the invitation to ${title ? `"${title}"` : "a workforce requirement"}`,
        href: invitationHref(lang, payload),
      };
    },
  },
  // FR-O2 step Submit and FR-N2 step Withdraw, to the employer: the partner's name and the requirement's own title.
  response_received: {
    label: "Responses",
    present: (payload, { lang }) => {
      const title = text(payload, "title");
      return {
        title: `${text(payload, "partner_name") ?? "A partner"} responded to ${title ? `"${title}"` : "your workforce requirement"}`,
        href: requirementResponsesHref(lang, payload),
      };
    },
  },
  response_withdrawn: {
    label: "Responses",
    present: (payload, { lang }) => {
      const title = text(payload, "title");
      return {
        title: `${text(payload, "partner_name") ?? "A partner"} withdrew its response to ${title ? `"${title}"` : "your workforce requirement"}`,
        href: requirementResponsesHref(lang, payload),
      };
    },
  },
  // FR-O3 step Inform, to the partner: its own decision only, the requirement as the partner knows it.
  response_decided: {
    label: "Responses",
    present: (payload, { lang }) => {
      const title = text(payload, "title");
      const employer = text(payload, "employer_name") ?? "The employer";
      const requirement = title ? `"${title}"` : "a workforce requirement";
      const sentences: Record<string, string> = {
        shortlisted: `${employer} shortlisted your response to ${requirement}`,
        selected: `${employer} selected your company for ${requirement}`,
        declined: `${employer} declined your response to ${requirement}`,
        submissions_allowed: `${employer} allows your company to submit candidates for ${requirement}`,
      };
      const decision = text(payload, "decision");
      return {
        title: decision && Object.hasOwn(sentences, decision) ? sentences[decision] : `${employer} decided your response to ${requirement}`,
        href: responseHref(lang, payload),
      };
    },
  },
  // FR-O4 step Invite, to the candidate: the partner asks to propose them; the request page answers it.
  submission_request: {
    label: "Submissions",
    present: (payload, { lang }) => {
      const title = text(payload, "title");
      const id = text(payload, "submission_id");
      return {
        title: `${text(payload, "partner_name") ?? "A recruitment company"} would like to propose you for ${title ? `"${title}"` : "a job"}`,
        href: id && /^[0-9a-f-]{36}$/.test(id) ? submissionPath(lang, id) : null,
      };
    },
  },
  // FR-O4 steps Approve and Withdraw, to the partner and the employer: never the candidate. The partner reads "a candidate
  // you proposed" rather than its own name (to_partner).
  submission_approved: {
    label: "Submissions",
    present: (payload, { lang }) => {
      const title = text(payload, "title");
      return {
        title: `${proposedCandidate(payload)} was submitted for ${title ? `"${title}"` : "a workforce requirement"}`,
        href: requirementSubmissionsHref(lang, payload),
      };
    },
  },
  submission_withdrawn: {
    label: "Submissions",
    present: (payload, { lang }) => {
      const title = text(payload, "title");
      return {
        title: `${proposedCandidate(payload)} withdrew from ${title ? `"${title}"` : "a workforce requirement"}`,
        href: requirementSubmissionsHref(lang, payload),
      };
    },
  },
  // FR-O5 AC10, to the partner: the stage its candidate reached, never the candidate, the note or the reason.
  submission_stage_changed: {
    label: "Submissions",
    present: (payload, { lang }) => {
      const title = text(payload, "title");
      const status = text(payload, "status");
      const requirement = title ? `"${title}"` : "a workforce requirement";
      return {
        title: isPipelineSubmissionStage(status)
          ? `A candidate you submitted for ${requirement} is now ${employerSubmissionLabels[status]}`
          : `The stage of a candidate you submitted for ${requirement} changed`,
        href: requirementSubmissionsHref(lang, payload),
      };
    },
  },
  // FR-Q1 AC8: the yearly question whether the Find Workers card should stay; only the date to answer by.
  visibility_confirmation: {
    label: "Find Workers",
    present: (payload, { lang }) => {
      const by = text(payload, "respond_by");
      return {
        title: by
          ? `Please confirm by ${formatDate(by)} that your card should stay in Find Workers`
          : "Please confirm that your card should stay in Find Workers",
        href: findWorkersCardPath(lang),
      };
    },
  },
  data_export_ready: {
    label: "Account",
    present: (payload, { lang }) => {
      const until = text(payload, "expires_at");
      return {
        title: until ? `Your data is ready to download until ${formatDate(until)}` : "Your data is ready to download",
        href: dataExportPath(lang),
      };
    },
  },
};

// A kind this version of the site does not know yet (a later release added it) still shows, without a link.
export function presentNotification(item: Pick<NotificationItem, "kind" | "payload">, context: Context): PresentedNotification {
  const entry = PRESENTERS[item.kind];
  if (!entry) return { title: "You have a new notification", kindLabel: "Notification", href: null };
  return { kindLabel: entry.label, ...entry.present(item.payload, context) };
}

export const presentedKinds: readonly string[] = Object.keys(PRESENTERS);
