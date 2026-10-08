"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ResultsPanel } from "@/components/admin/results-panel";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { usePagedSearch } from "@/components/admin/use-paged-search";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { TextLink } from "@/components/forms/text-link";
import { searchAuditAction } from "@/lib/actions/admin-search";
import type { AuditRow } from "@/lib/dal/admin";
import { formatDateTime } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";
import { auditFilterSchema, type AuditFilter, type AuditFilterForm, type TimeCursor } from "@/lib/validation/admin";

const emptyFilter: AuditFilterForm = { actor: "", action: "", entityType: "", entityId: "", from: "", to: "" };

export function AuditSearch({ lang }: { lang: string }) {
  const { control, handleSubmit } = useForm<AuditFilterForm, unknown, AuditFilter>({
    resolver: zodResolver(auditFilterSchema),
    defaultValues: emptyFilter,
  });
  const { state, page, search, next, previous, retry } = usePagedSearch<AuditFilter, AuditRow, NonNullable<TimeCursor>>(searchAuditAction);

  return (
    <div className="grid gap-6">
      <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(search)}>
        <InputField control={control} name="actor" label="Actor (user id)" autoComplete="off" />
        <InputField control={control} name="action" label="Action" description="For example user.suspend" autoComplete="off" maxLength={100} />
        <InputField control={control} name="entityType" label="Entity type" description="For example profile" autoComplete="off" maxLength={100} />
        <InputField control={control} name="entityId" label="Entity id" autoComplete="off" maxLength={200} />
        <InputField control={control} name="from" label="From (UTC)" type="date" />
        <InputField control={control} name="to" label="To (UTC)" type="date" />
        <div className="sm:col-span-2">
          <FormButton type="submit" busy={state.status === "loading"} className="w-full sm:w-auto">
            Search
          </FormButton>
        </div>
      </form>
      <ResultsPanel
        status={state.status}
        empty="No audit entries match"
        failure="The audit log could not be loaded"
        hasRows={state.rows.length > 0}
        page={page}
        hasNext={state.next !== null}
        onNext={next}
        onPrevious={previous}
        onRetry={retry}
      >
        <ResultsTable caption="Audit log, newest first" columns={["Time", "Actor", "Action", "Entity", "Reason"]}>
          {state.rows.map((row) => (
            <tr key={row.id}>
              <td className={cell}>{formatDateTime(row.createdAt)}</td>
              <td className={`${cell} break-all`}>
                {row.actorId ? <TextLink href={adminPath(lang, `users/${row.actorId}`)}>{row.actorId}</TextLink> : "System"}
              </td>
              <td className={`${cell} break-words`}>{row.action}</td>
              <td className={`${cell} break-all`}>
                {row.entityType}
                {row.entityId ? `: ${row.entityId}` : ""}
              </td>
              <td className={`${cell} break-words`}>{row.reason ?? ""}</td>
            </tr>
          ))}
        </ResultsTable>
      </ResultsPanel>
    </div>
  );
}
