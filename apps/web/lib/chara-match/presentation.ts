import * as z from "zod";
import { formatCount, formatDate } from "@/lib/i18n/format";

// The kinds of match of a run (ARCHITECTURE.md section 9.3), as chara_match_results names them, with the tab each has.
export const matchKinds = ["worker", "recruitment_partner", "staffing_partner"] as const;
export type MatchKind = (typeof matchKinds)[number];

export const matchKindLabels: Record<MatchKind, string> = {
  worker: "Workers",
  recruitment_partner: "Recruitment partners",
  staffing_partner: "Staffing partners",
};

// The address names a kind by a short word.
export const matchViews: Record<string, MatchKind> = { workers: "worker", recruitment: "recruitment_partner", staffing: "staffing_partner" };
export const matchViewOf: Record<MatchKind, string> = { worker: "workers", recruitment_partner: "recruitment", staffing_partner: "staffing" };

// Shown with every summary and list of matches: the matching reads profile data and promises nothing (brief section 7).
export const MATCH_DISCLAIMER =
  "Matches are based on the profile data workers and companies entered. They are not a guarantee of availability or of a successful hire.";

// One contribution of a rule to a match, as chara_match stores it.
export const reasonSchema = z.object({ rule: z.string(), points: z.number().int(), detail: z.string() });
export type MatchReason = z.infer<typeof reasonSchema>;

export type MatchNames = {
  countries: Record<string, string>;
  occupations: Record<string, string>;
  industries: Record<string, string>;
};

function countryNames(codes: string, names: MatchNames): string {
  return codes
    .split(",")
    .map((code) => names.countries[code] ?? code)
    .join(", ");
}

// "Why this match": one sentence per rule that contributed, in the words of the profile it was read from. A rule the page
// does not know yet is shown by its key, so a new rule is never hidden.
export function reasonText(reason: MatchReason, kind: MatchKind, names: MatchNames): string {
  const { rule, detail } = reason;
  const occupation = names.occupations[detail] ?? detail;
  switch (rule) {
    case "occupation":
      return kind === "worker" ? `Works as ${occupation}` : `Supplies ${occupation}`;
    case "work_authorization":
      return `May work in ${countryNames(detail, names)}`;
    case "preferred_country":
      return `Wants to work in ${countryNames(detail, names)}`;
    case "serves_destination":
      return `Serves ${countryNames(detail, names)}`;
    case "sources_from":
      return `Sources workers from ${countryNames(detail, names)}`;
    case "industry":
      return `Works in ${names.industries[detail] ?? detail}`;
    case "availability":
      if (kind !== "worker") return `${detail} workers listed as available by the start date`;
      return detail === "now" ? "Available now" : `Available from ${formatDate(detail)}`;
    default:
      return rule.replaceAll("_", " ");
  }
}

export function pointsText(points: number): string {
  return points === 1 ? "1 point" : `${formatCount(points)} points`;
}

export type MatchSummary = {
  matchingWorkers: number | null;
  workersFewerThan: number | null;
  recruitmentPartners: number;
  staffingPartners: number;
  availableWorkforce: string;
  sourceCountries: { code: string; name: string }[];
};

// The worker count as the summary says it: a count below k only as "fewer than k" (section 9.4).
export function matchingWorkersText(summary: Pick<MatchSummary, "matchingWorkers" | "workersFewerThan">): string {
  if (summary.matchingWorkers === null) return `Fewer than ${formatCount(summary.workersFewerThan ?? 5)} matching workers`;
  return summary.matchingWorkers === 1 ? "1 matching worker" : `${formatCount(summary.matchingWorkers)} matching workers`;
}

export function partnersText(count: number, kind: "recruitment" | "staffing"): string {
  return `${formatCount(count)} ${kind} ${count === 1 ? "partner" : "partners"}`;
}
