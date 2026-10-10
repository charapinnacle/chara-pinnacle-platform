import { NoteForm } from "@/components/applicants/note-form";
import { ReadOnlyButton } from "@/components/applicants/read-only-button";
import { READ_ONLY_REASON_ID } from "@/components/billing/read-only-plan";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ApplicantNote } from "@/lib/dal/applicant-review";
import { formatDateTime } from "@/lib/i18n/format";

type InternalNotesProps = {
  slug: string;
  applicationId: string;
  notes: ApplicantNote[];
  blocked: boolean;
  olderHref: string | null;
  newestHref: string | null;
};

// Notes belong to the organization: the candidate has no way to read them. Text is shown as typed, never as markup.
export function InternalNotes({ slug, applicationId, notes, blocked, olderHref, newestHref }: InternalNotesProps) {
  return (
    <section aria-labelledby="notes-heading" className="grid gap-3">
      <div className="grid gap-1">
        <h2 id="notes-heading" className="text-h2">
          Internal notes
        </h2>
        <p className="text-small text-muted-foreground">Visible to your organization only. The candidate never sees them.</p>
      </div>
      {blocked ? (
        <div className="grid gap-3">
          <Notice tone="info" role="status">
            Your organization has no active paid plan, so notes cannot be added. The notes written before stay readable.
          </Notice>
          <div className="grid gap-1.5">
            <Label htmlFor="internal-note-read-only">Add an internal note</Label>
            <Textarea id="internal-note-read-only" readOnly aria-disabled="true" aria-describedby={READ_ONLY_REASON_ID} rows={3} />
          </div>
          <div>
            <ReadOnlyButton className="w-full sm:w-auto">Add note</ReadOnlyButton>
          </div>
        </div>
      ) : (
        <NoteForm slug={slug} applicationId={applicationId} />
      )}
      {notes.length === 0 ? (
        <p className="text-small text-muted-foreground">No internal notes yet.</p>
      ) : (
        <ul className="grid gap-2">
          {notes.map((note) => (
            <Card as="li" padding="sm" key={note.id} className="gap-1">
              <p className="text-small font-medium text-muted-foreground">Internal note</p>
              <p className="wrap-anywhere whitespace-pre-line">{note.body}</p>
              <p className="text-small text-muted-foreground wrap-anywhere">
                {note.authorName ?? "Team member"}
                {" · "}
                <time dateTime={note.createdAt}>{formatDateTime(note.createdAt)}</time>
              </p>
            </Card>
          ))}
        </ul>
      )}
      {olderHref || newestHref ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-small">
          {olderHref ? (
            <TextLink standalone href={olderHref}>
              Show older notes
            </TextLink>
          ) : null}
          {newestHref ? (
            <TextLink standalone href={newestHref}>
              Back to the newest notes
            </TextLink>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
