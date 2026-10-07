import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SavedList } from "@/components/saved/saved-list";
import { listSavedJobs } from "@/lib/dal/saved-jobs";
import { requireUser } from "@/lib/dal/session";
import { parseSavedCursor, SAVED_HEADING_ID, savedPath } from "@/lib/jobs/saved";
import { homePath } from "@/lib/routes";

export const metadata: Metadata = { title: "Saved vacancies — CHARA", robots: { index: false } };

// For candidates only: a visitor goes to log in (requireUser), a company user gets the same page as for an address that
// does not exist, and an account that has not chosen its kind goes to the step that finishes it.
export default async function SavedPage({ params, searchParams }: PageProps<"/[lang]/saved">) {
  const { lang } = await params;
  const user = await requireUser(lang);
  if (user.accountKind === null) redirect(homePath(lang, null));
  if (user.accountKind !== "worker") notFound();

  const cursor = parseSavedCursor((await searchParams).cursor);
  const { jobs, nextCursor } = await listSavedJobs(cursor);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <header className="grid gap-1">
        <h1 id={SAVED_HEADING_ID} tabIndex={-1} className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
          Saved vacancies
        </h1>
        <p className="text-body text-muted-foreground">
          Your shortlist, newest first. A vacancy that is no longer open is flagged here and is removed from the list
          some time after it closed.
        </p>
      </header>
      <SavedList
        lang={lang}
        jobs={jobs}
        nextHref={nextCursor ? savedPath(lang, nextCursor) : null}
        firstHref={cursor ? savedPath(lang) : null}
      />
    </div>
  );
}
