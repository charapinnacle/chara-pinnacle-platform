import type { Database } from "@chara-pinnacle/db-types";
import { applicationStatusLabels } from "@/lib/applications/presentation";
import { formatDate } from "@/lib/i18n/format";
import { applicantPath, applicationPath, billingPath, homePath, jobPath, mfaPath, settingsPath } from "@/lib/routes";

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
export type PresentedNotification = { title: string; kindLabel: string; href: string | null };

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
  account_suspended: {
    label: "Account",
    present: (_payload, { lang }) => ({ title: "Your account was suspended", href: `/${lang}/suspended` }),
  },
  account_reinstated: {
    label: "Account",
    present: (_payload, { lang, accountKind }) => ({ title: "Your account was reinstated", href: homePath(lang, accountKind) }),
  },
  account_exists: {
    label: "Security",
    present: () => ({ title: "Someone tried to sign up with your email address", href: null }),
  },
};

// A kind this version of the site does not know yet (a later release added it) still shows, without a link.
export function presentNotification(item: Pick<NotificationItem, "kind" | "payload">, context: Context): PresentedNotification {
  const entry = PRESENTERS[item.kind];
  if (!entry) return { title: "You have a new notification", kindLabel: "Notification", href: null };
  return { ...entry.present(item.payload, context), kindLabel: entry.label };
}

export const presentedKinds: readonly string[] = Object.keys(PRESENTERS);
