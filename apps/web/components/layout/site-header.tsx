import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";

export function SiteHeader({ actions }: { actions?: React.ReactNode }) {
  return (
    <header className="border-b bg-card">
      <PageContainer className="flex min-h-16 flex-wrap items-center justify-between gap-x-4">
        <Link
          href="/"
          className="-mx-2 inline-flex h-11 items-center rounded-lg px-2 text-h2 tracking-wider text-primary"
        >
          CHARA
        </Link>
        {actions}
      </PageContainer>
    </header>
  );
}
