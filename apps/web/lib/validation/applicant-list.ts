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

function isSort(value: unknown): value is ApplicantSort {
  return typeof value === "string" && (applicantSorts as readonly string[]).includes(value);
}

// The list is addressed by the query of the page: a value that is not one the page offers falls back to the default
// (every vacancy, the list, the newest first, every stage, the first page) and never to an error. The board shows one
// vacancy, so it needs a vacancy.
export function parseApplicantListParams(params: Record<string, unknown>): ApplicantListParams {
  const { job, view, sort, dir, stage, page } = params;
  const jobId = typeof job === "string" && z.uuid().safeParse(job).success ? job : null;
  return {
    job: jobId,
    view: jobId && view === "board" ? "board" : "list",
    sort: isSort(sort) ? sort : "applied",
    dir: dir === "asc" ? "asc" : "desc",
    stage: isApplicationStatus(stage) ? stage : null,
    page: typeof page === "string" && /^[1-9]\d{0,2}$/.test(page) ? Number(page) : 1,
  };
}
