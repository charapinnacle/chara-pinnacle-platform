import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";

export function SiteHeader({ actions }: { actions?: React.ReactNode }) {
  return (
    <header className="border-b">
      <PageContainer className="flex h-14 items-center justify-between gap-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          CHARA
        </Link>
        {actions}
      </PageContainer>
    </header>
  );
}
