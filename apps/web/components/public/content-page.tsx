import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";

export function ContentPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children?: React.ReactNode;
}) {
  return (
    <PageContainer layout="page" className="grid max-w-3xl gap-10">
      <PageHeader size="display" title={title} description={lead} />
      {children}
    </PageContainer>
  );
}

export function ContentSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-h2">{heading}</h2>
      <div className="grid gap-3 leading-7">{children}</div>
    </section>
  );
}
