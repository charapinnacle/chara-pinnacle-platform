import { PageContainer } from "@/components/layout/page-container";

export function SiteFooter({ links }: { links?: React.ReactNode }) {
  return (
    <footer className="border-t">
      <PageContainer className="grid gap-4 py-8 text-small text-muted-foreground">
        {links}
        <p>&copy; CHARA</p>
      </PageContainer>
    </footer>
  );
}
