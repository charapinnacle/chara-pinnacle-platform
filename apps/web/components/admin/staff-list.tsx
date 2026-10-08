import { Users } from "lucide-react";
import { RevokeRoleDialog } from "@/components/admin/revoke-role-dialog";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { listStaff } from "@/lib/dal/admin";
import { formatShortDate } from "@/lib/i18n/format";
import { platformRoleLabels } from "@/lib/validation/admin";

export async function StaffList() {
  const staff = await listStaff();
  if (staff.length === 0) return <EmptyState icon={Users} title="No staff roles yet" />;

  return (
    <ResultsTable
      caption="Platform staff roles"
      columns={["Person", "Role", "Granted by", "Granted", "Revoked", "Two-step verification", "Last sign-in", "Action"]}
    >
      {staff.map((row) => (
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
  );
}
