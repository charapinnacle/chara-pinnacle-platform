import { PageContainer } from "@/components/layout/page-container";

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
      <header className="grid gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl sm:leading-tight">{title}</h1>
        <p className="text-lg leading-8 text-muted-foreground">{lead}</p>
      </header>
      {children}
    </PageContainer>
  );
}

export function ContentSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
      <div className="grid gap-3 leading-7">{children}</div>
    </section>
  );
}
