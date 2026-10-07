import type { Database } from "@chara-pinnacle/db-types";
import { z } from "zod";
import { isApplicationStatus } from "@/lib/applications/presentation";

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

const applicantSorts = ["applied", "stage", "completeness", "documents"] as const;

export type ApplicantSort = (typeof applicantSorts)[number];

export type ApplicantListParams = {
  job: string | null;
  view: "list" | "board";
  sort: ApplicantSort;
  dir: "asc" | "desc";
  stage: ApplicationStatus | null;
  page: number;
};

// Completeness and documents are not columns of the application, so a sort by either reads every application of the
// filter: they are offered for one vacancy only.
const vacancySorts: readonly ApplicantSort[] = ["completeness", "documents"];

function isSort(value: unknown): value is ApplicantSort {
  return typeof value === "string" && (applicantSorts as readonly string[]).includes(value);
}

// The list is addressed by the query of the page: a value that is not one the page offers falls back to the default
// (every vacancy, the list, the newest first, every stage, the first page) and never to an error. The board and the sorts
// by completeness and documents need a vacancy. A page past the last one is the last page (the read answers it), so a page
// is any whole number the offset of the read can hold.
export function parseApplicantListParams(params: Record<string, unknown>): ApplicantListParams {
  const { job, view, sort, dir, stage, page } = params;
  const jobId = typeof job === "string" && z.uuid().safeParse(job).success ? job : null;
  return {
    job: jobId,
    view: jobId && view === "board" ? "board" : "list",
    sort: isSort(sort) && (jobId || !vacancySorts.includes(sort)) ? sort : "applied",
    dir: dir === "asc" ? "asc" : "desc",
    stage: isApplicationStatus(stage) ? stage : null,
    page: typeof page === "string" && /^[1-9]\d{0,5}$/.test(page) ? Number(page) : 1,
  };
}
