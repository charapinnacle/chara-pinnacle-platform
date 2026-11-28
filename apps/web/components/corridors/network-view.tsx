import { Network as NetworkIcon } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card } from "@/components/layout/card";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { ImmigrationNotice } from "@/components/public/immigration-notice";
import { corridorsPath, countText, workforceText } from "@/lib/corridors/presentation";
import type { Network } from "@/lib/dal/corridors";
import { formatCount, formatDateTime } from "@/lib/i18n/format";

type Occupation = Network["industries"][number]["occupations"][number];

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-small text-muted-foreground">{label}</dt>
      <dd className="text-body font-semibold">{value}</dd>
    </div>
  );
}

function Countries({ label, countries, minCount }: { label: string; countries: Occupation["recruitment_sources"]; minCount: number }) {
  return (
    <div className="grid gap-1">
      <h4 className="text-small text-muted-foreground">{label}</h4>
      {countries.length > 0 ? (
        <ul className="grid gap-0.5 text-body">
          {countries.map(({ code, name, partners }) => (
            <li key={code}>
              {name}: {formatCount(partners)} companies
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body">No country with {minCount} or more companies yet</p>
      )}
    </div>
  );
}

// The network of one destination country as the brief draws it (section 19: Germany, Manufacturing, Welders): per industry
// and occupation the recruitment network by source country, the staffing network by the country the companies are based
// in, and the workers available. A list, not a map: the interactive map comes later.
export function NetworkView({ lang, network, directories }: { lang: string; network: Network; directories: boolean }) {
  const min = network.min_count;
  return (
    <PageContainer layout="page" className="grid max-w-5xl gap-8">
      <PageHeader
        className="animate-rise"
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Workforce corridors", href: corridorsPath(lang) },
              { label: `Network for ${network.destination_name}` },
            ]}
          />
        }
        title={`Workforce network for ${network.destination_name}`}
        description={`Recruitment and staffing partners that serve employers in ${network.destination_name}, by industry and occupation.`}
      />

      {network.industries.length === 0 ? (
        <div role="status">
          <EmptyState
            icon={NetworkIcon}
            title={`No network to show for ${network.destination_name} yet`}
            description={`An industry is shown once ${min} or more listed partners serve it here.`}
          >
            <TextLink standalone href={corridorsPath(lang)}>
              See all corridors
            </TextLink>
          </EmptyState>
        </div>
      ) : (
        network.industries.map((industry) => (
          <section key={industry.code} aria-labelledby={`industry-${industry.code}`} className="grid gap-4 border-t pt-6">
            <div className="grid gap-3">
              <h2 id={`industry-${industry.code}`} className="text-h2">
                {industry.name}
              </h2>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
                <Figure label="Workers available" value={workforceText(industry.workers_available)} />
                <Figure label="Recruitment partners" value={countText(industry.recruitment_partners, min)} />
                <Figure label="Staffing partners" value={countText(industry.staffing_partners, min)} />
              </dl>
            </div>
            {industry.occupations.length > 0 ? (
              <ul aria-label={`Occupations in ${industry.name}`} className="grid gap-3 md:grid-cols-2">
                {industry.occupations.map((occupation) => (
                  <Card as="li" key={occupation.code} padding="sm" className="gap-4">
                    <h3 className="text-h3">{occupation.label}</h3>
                    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
                      <Figure label="Workers available" value={workforceText(occupation.workers_available)} />
                      <Figure label="Recruitment partners" value={countText(occupation.recruitment_partners, min)} />
                      <Figure label="Staffing partners" value={countText(occupation.staffing_partners, min)} />
                    </dl>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Countries label="Recruitment network by source country" countries={occupation.recruitment_sources} minCount={min} />
                      <Countries label="Staffing network by country" countries={occupation.staffing_bases} minCount={min} />
                    </div>
                  </Card>
                ))}
              </ul>
            ) : null}
          </section>
        ))
      )}

      <div className="grid gap-2 text-small text-muted-foreground">
        <p>
          Counts below {min} are shown as “Fewer than {min}”, and industries, occupations and countries with fewer than {min}{" "}
          partners are not listed. The staffing network counts companies by the country they are based in. An interactive map
          of the network comes later.
        </p>
        {network.refreshed_at ? <p>Figures as of {formatDateTime(network.refreshed_at)}.</p> : null}
      </div>

      {directories ? <ImmigrationNotice lang={lang} /> : null}
    </PageContainer>
  );
}
