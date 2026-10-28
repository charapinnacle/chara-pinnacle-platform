import { AppNav } from "@/components/layout/app-nav";
import { AppShell } from "@/components/layout/app-shell";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { FooterLinks } from "@/components/layout/footer-links";
import { getUnreadNotificationCount } from "@/lib/dal/notifications";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { partnerSegments } from "@/lib/dashboard/partner-dashboard";
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

// The links of a partner organisation follow release 2a, the requirement and invitation links release 2b; a failed read
// counts the switch as off and keeps the header.
async function releasedOrOff(key: "release_partner_directories" | "release_job_orders"): Promise<boolean> {
  try {
    return await isReleased(key);
  } catch (error) {
    console.error("The release switch of the header could not be read", error);
    return false;
  }
}

// What the header offers follows the account kind and the organisations of the person; every page still asks for its
// own role, because a layout does not run again when a person moves between pages. A suspended account and an account
// whose kind is not committed yet (on the consent page) get the way out and nothing else.
export default async function AppLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  const user = await getCurrentUser();
  const accountKind = user && !user.suspended ? user.accountKind : null;
  const [organizations, notifications, partnersReleased, jobOrdersReleased] = await Promise.all([
    user && accountKind === "company" ? organizationsOrNone(user.id) : [],
    user && accountKind ? bellOrNone(user.id) : null,
    user && accountKind === "company" ? releasedOrOff("release_partner_directories") : false,
    user && accountKind === "company" ? releasedOrOff("release_job_orders") : false,
  ]);
  const navigation = user
    ? {
        lang,
        email: user.email,
        accountKind,
        // A partner organisation gets none of the employer links (FR-J1), and its own links only while release 2a is on.
        organizations: organizations
          .filter(({ type }) => type === "employer" || partnersReleased)
          .map(({ slug, displayName, role, suspended, type }) => ({
            slug,
            displayName,
            role,
            roleLabel: roleLabels[role],
            suspended,
            ...(type === "employer" ? {} : { partnerSegment: partnerSegments[type] }),
            ...(jobOrdersReleased ? { jobOrders: true as const } : {}),
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
