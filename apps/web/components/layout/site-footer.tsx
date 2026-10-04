import { PageContainer } from "@/components/layout/page-container";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <PageContainer className="py-8 text-sm text-muted-foreground">
        <p>&copy; CHARA</p>
      </PageContainer>
    </footer>
  );
}
