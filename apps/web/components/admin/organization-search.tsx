"use client";

import { AccountStatusBadge } from "@/components/admin/account-status-badge";
import { ResultsPanel } from "@/components/admin/results-panel";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { SearchBox } from "@/components/admin/search-box";
import { usePagedSearch } from "@/components/admin/use-paged-search";
import { TextLink } from "@/components/forms/text-link";
import { searchOrganizationsAction } from "@/lib/actions/admin-search";
import type { OrganizationRow } from "@/lib/dal/admin";
import { adminPath } from "@/lib/routes";
import type { NameCursor } from "@/lib/validation/admin";

export function OrganizationSearch({ lang }: { lang: string }) {
  const { state, page, search, next, previous, retry } = usePagedSearch<string, OrganizationRow, NonNullable<NameCursor>>(
    searchOrganizationsAction,
  );

  return (
    <div className="grid gap-page">
      <SearchBox
        label="Search organisations"
        description="Part of the display name, the legal name or the address name, or the organisation id."
        busy={state.status === "loading"}
        onSearch={search}
      />
      <ResultsPanel
        status={state.status}
        empty="No organisations found"
        failure="The organisations could not be loaded"
        hasRows={state.rows.length > 0}
        page={page}
        hasNext={state.next !== null}
        onNext={next}
        onPrevious={previous}
        onRetry={retry}
      >
        <ResultsTable caption="Organisations" columns={["Organisation", "Legal name", "Address name", "Status"]}>
          {state.rows.map((organization) => (
            <tr key={organization.id}>
              <td className={cell}>
                <TextLink href={adminPath(lang, `organizations/${organization.id}`)} className="break-words">
                  {organization.displayName}
                </TextLink>
              </td>
              <td className={`${cell} break-words`}>{organization.legalName}</td>
              <td className={`${cell} break-all`}>{organization.slug}</td>
              <td className={cell}>
                <AccountStatusBadge status={organization.status} />
              </td>
            </tr>
          ))}
        </ResultsTable>
      </ResultsPanel>
    </div>
  );
}
