import type { Database } from "@chara-pinnacle/db-types";
import { formatDate } from "@/lib/i18n/format";
import { salaryPeriodLabels } from "@/lib/validation/job";

type Enums = Database["public"]["Enums"];

type JobStatus = Enums["job_status"];
type JobModerationState = Enums["job_moderation_state"];

export const statusLabels: Record<JobStatus, string> = {
  draft: "Draft",
  open: "Open",
  paused: "Paused",
  closed: "Closed",
  filled: "Filled",
};

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && Object.hasOwn(statusLabels, value);
}

// A vacancy hidden by moderation is not public whatever its status.
export function jobStatusText(status: JobStatus, moderationState: JobModerationState): string {
  if (moderationState === "hidden") return "Hidden by moderation";
  if (moderationState !== "visible") return "Hidden - not public";
  return status === "open" ? statusLabels.open : `${statusLabels[status]} - not public`;
}

// status_changed_at of a draft is its creation time, so a draft shows the creation date.
export function jobDateText(job: { status: JobStatus; createdAt: string; statusChangedAt: string }): string {
  return job.status === "draft" ? `Created ${formatDate(job.createdAt)}` : `Status changed ${formatDate(job.statusChangedAt)}`;
}

const amountFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

type Salary = {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: Enums["salary_period"] | null;
};

// No conversion between currencies or periods: the salary is shown as the employer entered it.
export function formatSalary({ salaryMin, salaryMax, salaryCurrency, salaryPeriod }: Salary): string | null {
  if ((salaryMin === null && salaryMax === null) || !salaryCurrency || !salaryPeriod) return null;
  const money = (amount: number) => `${salaryCurrency} ${amountFormat.format(amount)}`;
  const period = salaryPeriodLabels[salaryPeriod].toLowerCase();
  if (salaryMin !== null && salaryMax !== null) {
    const range = salaryMin === salaryMax ? money(salaryMin) : `${money(salaryMin)} to ${amountFormat.format(salaryMax)}`;
    return `${range}, ${period}`;
  }
  return salaryMin !== null ? `From ${money(salaryMin)}, ${period}` : `Up to ${money(salaryMax ?? 0)}, ${period}`;
}

// The employer's website as a link target: only http and https are linked, and an address with a user name or password
// is not (the label shows the host only, so it would hide where the link really goes). Whatever the table let through,
// the rest is shown as nothing.
export function publicWebsite(value: string | null): { href: string; label: string } | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const linkable = (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
    return linkable ? { href: url.href, label: url.host } : null;
  } catch {
    return null;
  }
}
