import type { Database } from "@chara-pinnacle/db-types";
import { salaryPeriodLabels } from "@/lib/validation/job";

type Enums = Database["public"]["Enums"];

export type JobStatus = Enums["job_status"];
export type JobModerationState = Enums["job_moderation_state"];

const statusTexts: Record<JobStatus, string> = {
  draft: "Draft - not public",
  open: "Open",
  paused: "Paused - not public",
  closed: "Closed - not public",
  filled: "Filled - not public",
};

// A vacancy hidden by moderation is not public whatever its status.
export function jobStatusText(status: JobStatus, moderationState: JobModerationState): string {
  return moderationState === "visible" ? statusTexts[status] : "Hidden - not public";
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
