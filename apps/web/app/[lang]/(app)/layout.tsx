import { AppNav } from "@/components/layout/app-nav";
import { AppShell } from "@/components/layout/app-shell";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { FooterLinks } from "@/components/layout/footer-links";
import { getUnreadNotificationCount } from "@/lib/dal/notifications";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { isReleased } from "@/lib/dal/release";
import { getCurrentUser } from "@/lib/dal/session";
import { appFooterLinks } from "@/lib/public/navigation";
import { homePath } from "@/lib/routes";
import { roleLabels } from "@/lib/validation/team";

// A failed read of the organisations leaves the header without organisation links instead of replacing the whole page:
// an error boundary does not catch an error of the layout of its own segment, and every page asks for its own role anyway.
async function organizationsOrNone(userId: string): ReturnType<typeof getMyOrganizations> {
  try {
    return await getMyOrganizations(userId);
  } catch (error) {
    console.error("The organisations of the header could not be loaded", error);
    return [];
  }
}

// The bell is left out, rather than the page replaced, when the switch or the count cannot be read.
async function bellOrNone(userId: string): Promise<{ userId: string; initialUnread: number } | null> {
  try {
    if (!(await isReleased("release_partner_directories"))) return null;
    return { userId, initialUnread: await getUnreadNotificationCount() };
  } catch (error) {
    console.error("The unread notifications of the header could not be loaded", error);
    return null;
  }
}

// What the header offers follows the account kind and the organisations of the person; every page still asks for its
// own role, because a layout does not run again when a person moves between pages. A suspended account and an account
// whose kind is not committed yet (on the consent page) get the way out and nothing else.
export default async function AppLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  const user = await getCurrentUser();
  const accountKind = user && !user.suspended ? user.accountKind : null;
  const [organizations, notifications] = await Promise.all([
    user && accountKind === "company" ? organizationsOrNone(user.id) : [],
    user && accountKind ? bellOrNone(user.id) : null,
  ]);
  const navigation = user
    ? {
        lang,
        email: user.email,
        accountKind,
        organizations: organizations.map(({ slug, displayName, role, suspended }) => ({
          slug,
          displayName,
          role,
          roleLabel: roleLabels[role],
          suspended,
        })),
        notifications,
      }
    : null;

  return (
    <AppShell
      homeHref={accountKind ? homePath(lang, accountKind) : "/"}
      headerActions={navigation ? <AppNav {...navigation} /> : null}
      sidebar={navigation ? <AppSidebar {...navigation} /> : null}
      footerLinks={<FooterLinks lang={lang} label="Legal" links={appFooterLinks} />}
    >
      {children}
    </AppShell>
  );
}
