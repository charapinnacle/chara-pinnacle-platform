import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card } from "@/components/layout/card";
import { LinkButton } from "@/components/layout/link-button";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { CorridorFigures } from "@/components/corridors/corridor-list";
import { ImmigrationNotice } from "@/components/public/immigration-notice";
import { corridorDirectoryPaths, corridorsPath, networkPath } from "@/lib/corridors/presentation";
import type { Corridor } from "@/lib/dal/corridors";
import { formatDateTime } from "@/lib/i18n/format";

// One corridor as the brief draws it (section 18): workers available, recruitment partners, staffing partners and
// industries. A corridor with fewer partners than the threshold shows no figure, only that it has fewer. The links into
// the directories and the immigration notice need release 2a, whose pages they open.
export function CorridorView({ lang, corridor, directories }: { lang: string; corridor: Corridor; directories: boolean }) {
  const links = corridorDirectoryPaths(lang, corridor.source_country, corridor.destination_country);
  return (
    <PageContainer layout="page" className="grid max-w-4xl gap-8">
      <PageHeader
        className="animate-rise"
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Workforce corridors", href: corridorsPath(lang) },
              { label: `${corridor.source_name} to ${corridor.destination_name}` },
            ]}
          />
        }
        title={
          <>
            {corridor.source_name} <span aria-hidden>→</span>
            <span className="sr-only">to</span> {corridor.destination_name}
          </>
        }
        description={`Recruitment and staffing partners that source workers from ${corridor.source_name} for employers in ${corridor.destination_name}.`}
      />

      <Card as="section" aria-label="Corridor figures" padding="md" className="gap-6">
        {corridor.listed ? (
          <>
            <CorridorFigures row={corridor} minCount={corridor.min_count} />
            {corridor.industries.length > 0 ? (
              <div className="grid gap-1">
                <h2 className="text-small text-muted-foreground">Industries</h2>
                <p className="text-body font-semibold">{corridor.industries.map(({ name }) => name).join(", ")}</p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-body">
            Fewer than {corridor.min_count} listed partners work in this corridor, so its figures are not shown yet.
          </p>
        )}
        {directories ? (
          <div className="flex flex-wrap gap-3">
            <LinkButton href={links.recruitment}>See recruitment partners</LinkButton>
            <LinkButton href={links.staffing} variant="secondary">
              See staffing partners
            </LinkButton>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-2 text-small text-muted-foreground">
        <p>
          Counts below {corridor.min_count} are shown as “Fewer than {corridor.min_count}”. Workers available is a range of the
          listings partners confirmed recently, shown once {corridor.min_count} or more partners list workers here.
        </p>
        {corridor.refreshed_at ? <p>Figures as of {formatDateTime(corridor.refreshed_at)}.</p> : null}
        <p>
          <TextLink href={networkPath(lang, corridor.destination_country)}>
            See the workforce network for {corridor.destination_name}
          </TextLink>
        </p>
      </div>

      {directories ? <ImmigrationNotice lang={lang} /> : null}
    </PageContainer>
  );
}
