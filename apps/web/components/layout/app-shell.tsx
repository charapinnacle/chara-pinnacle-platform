import { BrandLink } from "@/components/layout/brand";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";

type AppShellProps = {
  homeHref: string;
  headerActions?: React.ReactNode;
  sidebar?: React.ReactNode;
  footerLinks?: React.ReactNode;
  children: React.ReactNode;
};

const column = "mx-auto w-full max-w-content px-4 sm:px-6 lg:px-10";

// The frame of the signed-in area and the console: from 1024 px a sidebar with the brand, the navigation and the
// identity at its foot; a top bar with the account menu (below 1024 px also the brand and the links); the page in a
// column of at most 75 rem; the legal links at the bottom.
export function AppShell({ homeHref, headerActions, sidebar, footerLinks, children }: AppShellProps) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[var(--spacing-sidebar)_minmax(0,1fr)]">
      <div className="hidden border-e bg-secondary/50 lg:block">
        <aside className="sticky top-0 flex h-dvh flex-col">
          <div className="flex min-h-16 items-center px-5">
            <BrandLink href={homeHref} subline />
          </div>
          {sidebar}
        </aside>
      </div>
      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="z-30 border-b bg-background/85 backdrop-blur-md md:sticky md:top-0">
          <div className={`${column} flex min-h-16 flex-wrap items-center justify-between gap-x-4 lg:justify-end`}>
            <BrandLink href={homeHref} className="lg:hidden" />
            {headerActions}
          </div>
        </header>
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex flex-1 flex-col outline-none">
          <div className={`${column} flex flex-1 flex-col py-8 lg:py-10`}>{children}</div>
        </main>
        <footer className="border-t">
          <div className={`${column} grid gap-4 py-8 text-small text-muted-foreground`}>
            {footerLinks}
            <p>&copy; CHARA</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
