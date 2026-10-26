import { cell, ResultsTable } from "@/components/admin/results-table";
import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { getPartnerModeration, type PartnerModeration } from "@/lib/dal/admin-reports";
import { formatCount, formatDate, formatDateTime } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";
import { reportReference } from "@/lib/validation/report";

const historyLabels: Record<string, string> = {
  content_hidden: "Partner profile hidden",
  content_unhidden: "Partner profile shown again",
  organization_suspended: "Organisation suspended",
  organization_reinstated: "Organisation reinstated",
};

// Staff read every availability listing of a partner to decide on it, the stale ones and those of a suspended or hidden
// partner included (DATA_MODEL.md 11.13), and the decisions taken so far. Nothing here is public.
export function PartnerModerationDetails({ lang, partner, headingLevel }: { lang: string; partner: PartnerModeration; headingLevel: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headingClass = headingLevel === 2 ? "text-h2" : "text-h3";

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Heading className={headingClass}>Availability listings</Heading>
        {partner.listings.length === 0 ? (
          <p className="text-body">This partner has no availability listings.</p>
        ) : (
          <ResultsTable caption="Availability listings, stale ones included" columns={["Occupation", "Source country", "Workers", "Confirmed"]}>
            {partner.listings.map((listing) => (
              <tr key={listing.id}>
                <td className={`${cell} break-words`}>{listing.occupation}</td>
                <td className={cell}>{listing.sourceCountry}</td>
                <td className={cell}>
                  {formatCount(listing.available)} available, {formatCount(listing.monthlyCapacity)} per month, from {formatDate(listing.availableFrom)}
                </td>
                <td className={cell}>
                  {listing.stale ? (
                    <StatusBadge status="warning" className="me-2">
                      Stale
                    </StatusBadge>
                  ) : null}
                  <time dateTime={listing.confirmedAt}>{formatDate(listing.confirmedAt)}</time>
                </td>
              </tr>
            ))}
          </ResultsTable>
        )}
      </div>
      <div className="grid gap-3">
        <Heading className={headingClass}>Decisions on this partner</Heading>
        {partner.history.length === 0 ? (
          <p className="text-body">No decision has been taken on this partner.</p>
        ) : (
          <ResultsTable caption="Decisions on this partner, newest first" columns={["Time", "Decision", "Statement of reasons", "Report"]}>
            {partner.history.map((entry) => (
              <tr key={entry.id}>
                <td className={cell}>{formatDateTime(entry.at)}</td>
                <td className={cell}>{historyLabels[entry.action] ?? entry.action}</td>
                <td className={`${cell} break-words whitespace-pre-line`}>{entry.reasons}</td>
                <td className={cell}>
                  {entry.reportId ? (
                    <TextLink href={adminPath(lang, `reports/${entry.reportId}`)} className="font-mono">
                      {reportReference(entry.reportId)}
                    </TextLink>
                  ) : (
                    "Own finding"
                  )}
                </td>
              </tr>
            ))}
          </ResultsTable>
        )}
      </div>
    </div>
  );
}

// The same read for the page of a report about a partner, in its own boundary so the report does not wait for it.
export async function ReportPartnerDetails({ lang, organizationId }: { lang: string; organizationId: string }) {
  const partner = await getPartnerModeration(organizationId);
  return partner ? <PartnerModerationDetails lang={lang} partner={partner} headingLevel={3} /> : null;
}
