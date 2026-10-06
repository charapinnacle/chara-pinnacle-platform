import { LegalLink } from "@/components/forms/text-link";
import type { AccessLogItem } from "@/lib/access-log/fetch-access-log";
import { formatDateTime } from "@/lib/i18n/format";

const FORMER_ORGANISATION = "A former organisation";
const DELETED_DOCUMENT = "Deleted document";
const COMPLAINTS_SLUG = "complaints-and-dispute-process";

export function AccessLogTable({ items }: { items: AccessLogItem[] }) {
  return (
    <div className="relative overflow-x-auto rounded-lg border">
      <table className="w-full text-start text-body">
        <caption className="sr-only">Openings of your documents by organisations, newest first</caption>
        <thead className="bg-muted/50 text-start text-sm">
          <tr>
            {["Organisation", "Document", "Date and time", "Purpose"].map((heading) => (
              <th key={heading} scope="col" className="px-3 py-2 text-start font-semibold">
                {heading}
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-start font-semibold">
              <span className="sr-only">Report</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const organisation = item.organizationName ?? FORMER_ORGANISATION;
            const document = item.documentTitle ?? DELETED_DOCUMENT;
            return (
              <tr key={item.id} className="border-t align-top">
                <th scope="row" className="min-w-32 px-3 py-3 text-start font-medium break-words">
                  {organisation}
                </th>
                <td className="min-w-32 px-3 py-3 break-words">{document}</td>
                <td className="px-3 py-3">
                  <time dateTime={item.accessedAt}>{formatDateTime(item.accessedAt)}</time>
                </td>
                <td className="px-3 py-3">Application review</td>
                <td className="px-3 py-3">
                  <LegalLink slug={COMPLAINTS_SLUG} newTabLabel="(opens in a new tab)">
                    Report suspicious access
                    <span className="sr-only">
                      {" "}
                      to {document} by {organisation}
                    </span>
                  </LegalLink>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
