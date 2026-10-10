import { AppNav } from "@/components/layout/app-nav";
import { AppShell } from "@/components/layout/app-shell";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { FooterLinks } from "@/components/layout/footer-links";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { getCurrentUser } from "@/lib/dal/session";
import { BILLING_TERMS_PATH } from "@/lib/public/navigation";
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

// What the header offers follows the account kind and the organisations of the person; every page still asks for its
// own role, because a layout does not run again when a person moves between pages. A suspended account and an account
// whose kind is not committed yet (onboarding) get the way out and nothing else.
export default async function AppLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  const user = await getCurrentUser();
  const accountKind = user && !user.suspended ? user.accountKind : null;
  const organizations = user && accountKind === "company" ? await organizationsOrNone(user.id) : [];
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
      }
    : null;

  return (
    <AppShell
      homeHref={accountKind ? homePath(lang, accountKind) : "/"}
      headerActions={navigation ? <AppNav {...navigation} /> : null}
      sidebar={navigation ? <AppSidebar {...navigation} /> : null}
      footerLinks={<FooterLinks lang={lang} hidePaths={accountKind === "company" ? [] : [BILLING_TERMS_PATH]} />}
    >
      {children}
    </AppShell>
  );
}
