"use client";

import { AccountStatusBadge } from "@/components/admin/account-status-badge";
import { ResultsPanel } from "@/components/admin/results-panel";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { SearchBox } from "@/components/admin/search-box";
import { usePagedSearch } from "@/components/admin/use-paged-search";
import { TextLink } from "@/components/forms/text-link";
import { searchUsersAction } from "@/lib/actions/admin-search";
import type { UserRow } from "@/lib/dal/admin";
import { formatShortDate } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";
import type { NameCursor } from "@/lib/validation/admin";

export function UserSearch({ lang }: { lang: string }) {
  const { state, page, search, next, previous, retry } = usePagedSearch<string, UserRow, NonNullable<NameCursor>>(searchUsersAction);

  return (
    <div className="grid gap-page">
      <SearchBox
        label="Search users"
        description="Part of the display name, the whole email address or the user id."
        busy={state.status === "loading"}
        onSearch={search}
      />
      <ResultsPanel
        status={state.status}
        empty="No users found"
        failure="The users could not be loaded"
        hasRows={state.rows.length > 0}
        page={page}
        hasNext={state.next !== null}
        onNext={next}
        onPrevious={previous}
        onRetry={retry}
      >
        <ResultsTable caption="Users" columns={["User", "Email", "Account", "Status", "Created"]}>
          {state.rows.map((user) => (
            <tr key={user.id}>
              <td className={cell}>
                <TextLink href={adminPath(lang, `users/${user.id}`)} className="break-words">
                  {user.displayName ?? user.email}
                </TextLink>
              </td>
              <td className={`${cell} break-all`}>{user.email}</td>
              <td className={cell}>{user.accountKind === "company" ? "Employer" : user.accountKind === "worker" ? "Candidate" : "Not chosen"}</td>
              <td className={cell}>
                <AccountStatusBadge status={user.status} />
              </td>
              <td className={cell}>{formatShortDate(user.createdAt)}</td>
            </tr>
          ))}
        </ResultsTable>
      </ResultsPanel>
    </div>
  );
}
