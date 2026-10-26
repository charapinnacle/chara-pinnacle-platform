import type { Database } from "@chara-pinnacle/db-types";
import { applicationStatusLabels } from "@/lib/applications/presentation";
import { formatDate } from "@/lib/i18n/format";
import {
  appealPath,
  applicantPath,
  applicationPath,
  billingPath,
  companyPagePath,
  dataExportPath,
  employerDashboardPath,
  homePath,
  jobPath,
  mfaPath,
  myReportsPath,
  partnerStepPath,
  settingsPath,
  whereYouServePath,
  workforceProfilePath,
} from "@/lib/routes";
import { infoStepLabels, infoStepSchema, type InfoStep } from "@/lib/validation/partner-review";

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

function documentName(slug: string): string {
  const name = slug.replace(/[-_]+/g, " ").trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function isApplicationStatus(value: string | undefined): value is ApplicationStatus {
  return value !== undefined && Object.hasOwn(applicationStatusLabels, value);
}

// The onboarding step staff reopened with a request for information (FR-J4).
function infoStepPath(lang: string, step: InfoStep): string {
  return step === "where_you_serve" ? whereYouServePath(lang) : partnerStepPath(lang, step);
}

// The moderation decision a notice names, which its appeal page is addressed by.
function decisionId(payload: Record<string, unknown>): number | null {
  const value = payload.moderation_action_id;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function licencePath(lang: string, payload: Record<string, unknown>): string | null {
  const slug = text(payload, "org_slug");
  return slug ? `${workforceProfilePath(lang, slug)}#licences-heading` : null;
}

type Presenter = (payload: Record<string, unknown>, context: Context) => Omit<PresentedNotification, "kindLabel">;

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
        href: step.success ? infoStepPath(lang, step.data) : partnerStepPath(lang, "ready"),
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
  followed_company_activity: {
    label: "Followed companies",
    present: (payload, { lang }) => {
      const org = text(payload, "org_name") ?? "A company you follow";
      const total = Number(text(payload, "total"));
      const vacancies = Array.isArray(payload.vacancies) ? (payload.vacancies as Record<string, unknown>[]) : [];
      const first = vacancies[0] ? text(vacancies[0], "job_title") : undefined;
      const slug = text(payload, "org_slug");
      return {
        title:
          total === 1 && first
            ? `${org} published a new vacancy: ${first}`
            : total > 1
              ? `${org} published ${total} new vacancies`
              : `${org} published new vacancies`,
        href: slug ? companyPagePath(lang, slug) : null,
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
      const title = text(payload, "title") ?? "Your partner profile";
      const slug = text(payload, "org_slug");
      const unhidden = text(payload, "decision") === "unhide";
      return {
        title: unhidden ? `${title} is shown again` : `${title} was hidden by moderation`,
        href: slug ? `${workforceProfilePath(lang, slug)}${unhidden ? "" : "#moderation-heading"}` : null,
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
  return { ...entry.present(item.payload, context), kindLabel: entry.label };
}

export const presentedKinds: readonly string[] = Object.keys(PRESENTERS);
