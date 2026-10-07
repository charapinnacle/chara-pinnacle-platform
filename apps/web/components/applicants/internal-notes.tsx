import { NoteForm } from "@/components/applicants/note-form";
import { Notice } from "@/components/forms/notice";
import type { ApplicantNote } from "@/lib/dal/applicant-review";
import { formatDateTime } from "@/lib/i18n/format";

type InternalNotesProps = {
  slug: string;
  applicationId: string;
  notes: ApplicantNote[];
  blocked: boolean;
  limit: number;
};

// Notes belong to the organization: the candidate has no way to read them. Text is shown as typed, never as markup.
export function InternalNotes({ slug, applicationId, notes, blocked, limit }: InternalNotesProps) {
  return (
    <section aria-labelledby="notes-heading" className="grid gap-3">
      <div className="grid gap-1">
        <h2 id="notes-heading" className="text-lg font-semibold">
          Internal notes
        </h2>
        <p className="text-sm text-muted-foreground">Visible to your organization only. The candidate never sees them.</p>
      </div>
      {blocked ? (
        <Notice tone="info" role="status">
          Your organization has no active paid plan, so notes cannot be added. The notes written before stay readable.
        </Notice>
      ) : (
        <NoteForm slug={slug} applicationId={applicationId} />
      )}
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No internal notes yet.</p>
      ) : (
        <ul className="grid gap-2">
          {notes.map((note) => (
            <li key={note.id} className="grid gap-1 rounded-xl border bg-card p-3">
              <p className="text-sm font-medium text-muted-foreground">Internal note</p>
              <p className="wrap-anywhere whitespace-pre-line">{note.body}</p>
              <p className="text-sm text-muted-foreground wrap-anywhere">
                {note.authorName ?? "Team member"}
                {" · "}
                <time dateTime={note.createdAt}>{formatDateTime(note.createdAt)}</time>
              </p>
            </li>
          ))}
          {notes.length === limit ? <li className="text-sm text-muted-foreground">Only the latest {limit} notes are shown.</li> : null}
        </ul>
      )}
    </section>
  );
}
