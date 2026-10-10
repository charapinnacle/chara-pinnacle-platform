import { AdminNav } from "@/components/admin/admin-nav";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AccountMenu } from "@/components/layout/account-panel";
import { AppShell } from "@/components/layout/app-shell";
import { entriesFor } from "@/lib/admin/navigation";
import { getCurrentUser, getPlatformRoles } from "@/lib/dal/session";
import { adminPath } from "@/lib/routes";
import { platformRoleLabels } from "@/lib/validation/admin";

// The navigation is only a convenience: every page asks for its role itself, because a layout does not run again when a
// person moves between pages. A visitor, a user without a role and a Verification Reviewer get no entries.
export default async function AdminLayout({ children, params }: LayoutProps<"/[lang]/admin">) {
  const { lang } = await params;
  const user = await getCurrentUser();
  const roles = user ? await getPlatformRoles() : [];
  const entries = entriesFor(roles).map(({ label, segment }) => ({ label, segment, href: adminPath(lang, segment) }));
  const roleLabel = roles.map((role) => platformRoleLabels[role]).join(", ") || undefined;

  return (
    <AppShell
      homeHref={adminPath(lang)}
      headerActions={user ? <AccountMenu email={user.email} roleLabel={roleLabel} links={[]} /> : null}
      sidebar={user ? <AdminSidebar entries={entries} email={user.email} roleLabel={roleLabel} /> : null}
    >
      <div className="grid min-w-0 gap-page">
        {entries.length > 0 ? <AdminNav entries={entries} className="lg:hidden" /> : null}
        {children}
      </div>
    </AppShell>
  );
}
