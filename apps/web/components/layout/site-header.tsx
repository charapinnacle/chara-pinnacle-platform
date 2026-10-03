import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";

export function SiteHeader() {
  return (
    <header className="border-b">
      <PageContainer className="flex h-14 items-center">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          CHARA
        </Link>
      </PageContainer>
    </header>
  );
}
