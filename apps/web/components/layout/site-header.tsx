import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";

export function SiteHeader({ actions }: { actions?: React.ReactNode }) {
  return (
    <header className="border-b bg-card">
      <PageContainer className="flex h-14 items-center justify-between gap-4">
        <Link
          href="/"
          className="-mx-2 inline-flex h-11 items-center rounded-lg px-2 text-lg font-bold tracking-wider text-primary"
        >
          CHARA
        </Link>
        {actions}
      </PageContainer>
    </header>
  );
}
