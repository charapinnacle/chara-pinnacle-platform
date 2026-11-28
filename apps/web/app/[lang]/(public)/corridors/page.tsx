import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CorridorList } from "@/components/corridors/corridor-list";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { parseCorridorFilters } from "@/lib/corridors/presentation";
import { listCorridors } from "@/lib/dal/corridors";
import { isReleased } from "@/lib/dal/release";
import { formatDateTime } from "@/lib/i18n/format";
import { corridorsPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/corridors">): Promise<Metadata> {
  const { lang } = await params;
  return (await isReleased("release_corridors")) ? corridorsPageMetadata(lang) : {};
}

// The Workforce corridors item of the public Menu (brief section 18, release_corridors): every corridor from a source
// country to a destination country with enough listed partners, none hard-coded (OPEN_QUESTIONS.md L2). Rendered per
// request: the address holds the two filters. Not found while the release is off.
export default async function CorridorsPage({ params, searchParams }: PageProps<"/[lang]/corridors">) {
  const [{ lang }, rawParams] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_corridors"))) notFound();
  const list = await listCorridors();
  if (!list) notFound();

  return (
    <PageContainer layout="page" className="grid gap-8">
      <PageHeader title="Workforce corridors" className="animate-rise">
        <p className="text-body text-muted-foreground">
          Where listed recruitment and staffing partners source workers from, and the countries they recruit for. Every figure
          comes from the partners&apos; own profiles and listings.
        </p>
      </PageHeader>
      <CorridorList lang={lang} list={list} filters={parseCorridorFilters(rawParams)} />
      <div className="grid gap-2 text-small text-muted-foreground">
        <p>
          A corridor is listed once {list.min_count} or more partners work in it. Counts below {list.min_count} are shown as
          “Fewer than {list.min_count}”, and workers available is a range, shown once {list.min_count} or more partners list
          workers in the corridor.
        </p>
        {list.refreshed_at ? <p>Figures as of {formatDateTime(list.refreshed_at)}.</p> : null}
      </div>
    </PageContainer>
  );
}
