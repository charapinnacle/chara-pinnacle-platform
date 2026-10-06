import type { Database } from "@chara-pinnacle/db-types";

type JobStatus = Database["public"]["Enums"]["job_status"];

export type StatusAction = {
  to: Exclude<JobStatus, "draft">;
  label: string;
  done: string;
  confirm?: { title: string; body: string; button: string };
};

const publish: StatusAction = { to: "open", label: "Publish", done: "The vacancy is published" };
const reopen: StatusAction = { to: "open", label: "Reopen", done: "The vacancy is open again" };
const pause: StatusAction = { to: "paused", label: "Pause", done: "The vacancy is paused" };
const close: StatusAction = {
  to: "closed",
  label: "Close",
  done: "The vacancy is closed",
  confirm: {
    title: "Close this vacancy?",
    body: "It leaves the public pages at once and takes no new applications. You can reopen it later.",
    button: "Close vacancy",
  },
};
const fill: StatusAction = {
  to: "filled",
  label: "Mark as filled",
  done: "The vacancy is marked as filled",
  confirm: {
    title: "Mark this vacancy as filled?",
    body: "This is final. A filled vacancy cannot be changed again, and it leaves the public pages at once.",
    button: "Mark as filled",
  },
};

// The changes the database guard allows an owner or admin; the guard is the authority, this only decides what to offer.
export const statusActions: Record<JobStatus, StatusAction[]> = {
  draft: [publish],
  open: [pause, close, fill],
  paused: [reopen, close, fill],
  closed: [reopen],
  filled: [],
};

const STALE_AFTER_DAYS = 90;
const DAY_MS = 86_400_000;
export const STALE_OPEN_TEXT = `Open for more than ${STALE_AFTER_DAYS} days`;

// Only an Open vacancy goes stale, counted from its last change of status; the flag is shown, nothing is sent.
export function isStaleOpen(status: JobStatus, statusChangedAt: string, now: Date): boolean {
  return status === "open" && now.getTime() - new Date(statusChangedAt).getTime() > STALE_AFTER_DAYS * DAY_MS;
}
