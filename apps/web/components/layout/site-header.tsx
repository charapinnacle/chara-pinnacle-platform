import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";

export function SiteHeader() {
  return (
    <header className="border-b bg-card">
      <PageContainer className="flex h-14 items-center">
        <Link
          href="/"
          className="rounded-sm text-lg font-bold tracking-wider text-primary"
        >
          CHARA
        </Link>
      </PageContainer>
    </header>
  );
}
