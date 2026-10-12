import { LogoutButton } from "@/components/auth/logout-button";
import { BrandLink } from "@/components/layout/brand";
import { FooterLinks } from "@/components/layout/footer-links";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { appFooterLinks } from "@/lib/public/navigation";
import "@/components/onboarding/onboarding.css";

// No navigation and no account menu: none of it can be used before the steps are done.
export default async function OnboardingLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  return (
    <div className="onboarding-step flex min-h-dvh flex-col">
      <header>
        <div className="mx-auto flex min-h-16 w-full max-w-content items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
          <BrandLink href={`/${lang}`} subline />
          <LogoutButton className="min-w-0 border-transparent bg-transparent px-3 text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground" />
        </div>
      </header>
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 outline-none">
        <div className="mx-auto w-full max-w-[35rem] px-4 pt-6 pb-16 sm:px-6 sm:pt-12 lg:pt-16">{children}</div>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-content flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-4 text-small text-muted-foreground sm:px-6 lg:px-10">
          <FooterLinks lang={lang} label="Legal" links={appFooterLinks} />
          <p>&copy; CHARA</p>
        </div>
      </footer>
    </div>
  );
}
