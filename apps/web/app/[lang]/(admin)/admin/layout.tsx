import { AdminNav } from "@/components/admin/admin-nav";
import { LogoutButton } from "@/components/auth/logout-button";
import { PageContainer } from "@/components/layout/page-container";
import { SiteShell } from "@/components/layout/site-shell";
import { entriesFor } from "@/lib/admin/navigation";
import { getCurrentUser, getPlatformRoles } from "@/lib/dal/session";
import { adminPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

// The navigation is only a convenience: every page asks for its role itself, because a layout does not run again when a
// person moves between pages. A visitor, a user without a role and a Verification Reviewer get no entries.
export default async function AdminLayout({ children, params }: LayoutProps<"/[lang]/admin">) {
  const { lang } = await params;
  const roles = (await getCurrentUser()) ? await getPlatformRoles() : [];
  const entries = entriesFor(roles).map(({ label, segment }) => ({ label, href: adminPath(lang, segment) }));

  return (
    <SiteShell headerActions={<LogoutButton />}>
      <PageContainer layout="page" className={cn("grid grid-cols-[minmax(0,1fr)] items-start gap-6", entries.length > 0 && "lg:grid-cols-[16rem_minmax(0,1fr)]")}>
        {entries.length > 0 ? <AdminNav entries={entries} /> : null}
        <div className="min-w-0">{children}</div>
      </PageContainer>
    </SiteShell>
  );
}
