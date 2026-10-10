import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";

// The long-form pages about CHARA: a display title with its lead, then sections in an editorial grid (the heading in a
// narrow column beside the text from 1024 px), each text kept to a readable measure.
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
    <PageContainer layout="page" className="grid gap-12 sm:gap-16">
      <PageHeader size="display" title={title} description={lead} className="max-w-3xl animate-rise" />
      <div className="grid animate-stagger gap-12">{children}</div>
    </PageContainer>
  );
}

export function ContentSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t pt-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
      <h2 className="text-h2">{heading}</h2>
      <div className="grid max-w-[65ch] gap-3 leading-7">{children}</div>
    </section>
  );
}
