import { PageContainer } from "@/components/layout/page-container";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <PageContainer className="py-6 text-sm text-muted-foreground">
        <p>&copy; CHARA</p>
      </PageContainer>
    </footer>
  );
}
