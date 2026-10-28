import { Notice } from "@/components/forms/notice";
import { formatDateTime } from "@/lib/i18n/format";
import { changedByText, changeLines, type ChangeNames, type RequirementVersion } from "@/lib/requirements/versions";

type RequirementHistoryProps = {
  // The id of the section, which the change notices link to on the invitation page.
  id: string;
  title: string;
  intro: string;
  empty: string;
  // null when the history could not be read: the page stays up and says so.
  versions: RequirementVersion[] | null;
  names: ChangeNames;
};

// The saved edits of a published requirement, newest first (FR-M2 step Edit): when, for the employer who saved it, and
// each changed field with its old and new value. The employer's requirement page and the partner's invitation page show
// it; the partner's list holds only the edits since its invitation and never names the member.
export function RequirementHistory({ id, title, intro, empty, versions, names }: RequirementHistoryProps) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className="grid scroll-mt-24 gap-3">
      <h2 id={headingId} className="text-h2">
        {title}
      </h2>
      {versions === null ? (
        <Notice tone="warning" role="status">
          The changes could not be loaded. Reload the page to try again.
        </Notice>
      ) : (
        <>
          <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">{intro}</p>
          {versions.length === 0 ? (
            <p className="text-small text-muted-foreground">{empty}</p>
          ) : (
            <ol className="grid gap-4" aria-label={title}>
              {versions.map((version) => {
                const who = changedByText(version.changedBy);
                return (
                  <li key={version.version} className="grid gap-3 rounded-xl border bg-card p-card">
                    <p className="text-small text-muted-foreground">
                      Changed on <time dateTime={version.createdAt}>{formatDateTime(version.createdAt)}</time>
                      {who ? ` by ${who}` : ""}
                    </p>
                    <dl className="grid gap-3">
                      {changeLines(version, names).map((line) => (
                        <div key={line.field} className="grid gap-1">
                          <dt className="font-medium">{line.label}</dt>
                          <dd className="grid gap-0.5 text-body break-words">
                            <span>
                              <span className="text-muted-foreground">Before: </span>
                              <span className="whitespace-pre-line">{line.before}</span>
                            </span>
                            <span>
                              <span className="text-muted-foreground">After: </span>
                              <span className="whitespace-pre-line">{line.after}</span>
                            </span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
