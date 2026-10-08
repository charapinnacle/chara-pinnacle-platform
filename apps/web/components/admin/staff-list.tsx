import { Users } from "lucide-react";
import { RevokeRoleDialog } from "@/components/admin/revoke-role-dialog";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { listStaff } from "@/lib/dal/admin";
import { formatShortDate } from "@/lib/i18n/format";
import { adminPath } from "@/lib/routes";
import { platformRoleLabels } from "@/lib/validation/admin";

export async function StaffList({ lang, after }: { lang: string; after: number | null }) {
  const page = await listStaff(after);
  if (page.rows.length === 0) return <EmptyState icon={Users} title="No staff roles yet" />;

  return (
    <div className="grid gap-4">
      <ResultsTable
        caption="Platform staff roles, newest first"
        columns={["Person", "Role", "Granted by", "Granted", "Revoked", "Two-step verification", "Last sign-in", "Action"]}
      >
        {page.rows.map((row) => (
          <tr key={row.id}>
            <td className={`${cell} break-all`}>
              {row.displayName ? <span className="block font-medium">{row.displayName}</span> : null}
              {row.email}
            </td>
            <td className={cell}>{platformRoleLabels[row.role]}</td>
            <td className={`${cell} break-all`}>{row.grantedByEmail ?? "Set up by the platform team"}</td>
            <td className={cell}>{formatShortDate(row.grantedAt)}</td>
            <td className={cell}>{row.revokedAt ? formatShortDate(row.revokedAt) : "Active"}</td>
            <td className={cell}>{row.mfaEnrolled ? "Enrolled" : "Not enrolled"}</td>
            <td className={cell}>{row.lastSignInAt ? formatShortDate(row.lastSignInAt) : "Never"}</td>
            <td className={cell}>
              {row.revokedAt ? null : (
                <RevokeRoleDialog userId={row.userId} role={row.role} roleLabel={platformRoleLabels[row.role]} person={row.email} />
              )}
            </td>
          </tr>
        ))}
      </ResultsTable>
      {page.next ? (
        <TextLink standalone href={`${adminPath(lang, "staff")}?after=${page.next}`}>
          Show older entries
        </TextLink>
      ) : null}
      {after ? (
        <TextLink standalone href={adminPath(lang, "staff")}>
          Back to the newest entries
        </TextLink>
      ) : null}
    </div>
  );
}
