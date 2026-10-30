import { Notice } from "@/components/forms/notice";
import { formatDateTime } from "@/lib/i18n/format";
import { versionChangeLines, type ResponseVersion } from "@/lib/responses/presentation";

// The versions of a response, newest first, each with the fields it changed from the one before (FR-O2 AC8, AC9); version
// 1 is the response as sent. null when the history could not be read: the page stays up and says so.
export function ResponseVersions({ versions }: { versions: ResponseVersion[] | null }) {
  return (
    <section id="history" aria-labelledby="response-history-heading" className="grid scroll-mt-24 gap-3">
      <h2 id="response-history-heading" className="text-h2">
        History
      </h2>
      {versions === null ? (
        <Notice tone="warning" role="status">
          The history could not be loaded. Reload the page to try again.
        </Notice>
      ) : (
        <ol className="grid gap-4" aria-label="Versions">
          {versions.map((version, index) => {
            const lines = versionChangeLines(version, versions[index + 1]);
            return (
              <li key={version.version} className="grid gap-2 rounded-xl border bg-card p-card">
                <p className="font-medium">
                  Version {version.version} · <time dateTime={version.createdAt}>{formatDateTime(version.createdAt)}</time>
                </p>
                {version.version === 1 ? (
                  <p className="text-small text-muted-foreground">The response as it was sent.</p>
                ) : lines.length === 0 ? (
                  <p className="text-small text-muted-foreground">No field changed.</p>
                ) : (
                  <ul className="grid gap-2">
                    {lines.map((line) => (
                      <li key={line.label} className="grid gap-0.5">
                        <span className="text-small text-muted-foreground">{line.label}</span>
                        <span className="break-words whitespace-pre-line">
                          {line.before} <span aria-hidden>→</span>
                          <span className="sr-only"> changed to </span> {line.after}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
