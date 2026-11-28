import { Waypoints } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { FormButton } from "@/components/forms/form-button";
import { NativeSelect } from "@/components/forms/native-select";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { corridorPath, corridorsPath, countText, networkPath, workforceText } from "@/lib/corridors/presentation";
import type { CorridorList, CorridorRow } from "@/lib/dal/corridors";

type Country = { code: string; name: string };
type Filters = { source?: string; destination?: string };

// The countries that occur on one side of the listed corridors, by name, for the filters.
function sideCountries(corridors: readonly CorridorRow[], side: "source" | "destination"): Country[] {
  const byCode = new Map(corridors.map((row) => [row[`${side}_country`], row[`${side}_name`]]));
  return [...byCode].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function CountrySelect({ id, name, label, any, countries, value }: { id: string; name: string; label: string; any: string; countries: Country[]; value?: string }) {
  return (
    <div className="grid gap-2 sm:w-64">
      <label htmlFor={id} className="text-small leading-snug font-medium">
        {label}
      </label>
      <NativeSelect id={id} name={name} defaultValue={value ?? ""}>
        <option value="">{any}</option>
        {countries.map(({ code, name: countryName }) => (
          <option key={code} value={code}>
            {countryName}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

// A corridor as one compact card: the two countries and its three figures, as the brief lists them (section 18).
export function CorridorFigures({ row, minCount }: { row: Pick<CorridorRow, "recruitment_partners" | "staffing_partners" | "workers_available">; minCount: number }) {
  const items = [
    { label: "Workers available", value: workforceText(row.workers_available) },
    { label: "Recruitment partners", value: countText(row.recruitment_partners, minCount) },
    { label: "Staffing partners", value: countText(row.staffing_partners, minCount) },
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
      {items.map(({ label, value }) => (
        <div key={label} className="grid gap-0.5">
          <dt className="text-small text-muted-foreground">{label}</dt>
          <dd className="text-body font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// The index of the listed corridors with its two filters, which are plain GET parameters (the page is rendered per request).
export function CorridorList({ lang, list, filters }: { lang: string; list: CorridorList; filters: Filters }) {
  const shown = list.corridors.filter(
    (row) => (!filters.source || row.source_country === filters.source) && (!filters.destination || row.destination_country === filters.destination),
  );
  const filtered = filters.source !== undefined || filters.destination !== undefined;
  const destination = filters.destination ? list.corridors.find((row) => row.destination_country === filters.destination) : undefined;

  return (
    <div className="grid gap-6">
      <form action={corridorsPath(lang)} method="get" role="search" aria-label="Filter corridors" className="flex flex-wrap items-end gap-3">
        <CountrySelect
          id="corridor-destination"
          name="destination"
          label="Destination country"
          any="All destinations"
          countries={sideCountries(list.corridors, "destination")}
          value={filters.destination}
        />
        <CountrySelect
          id="corridor-source"
          name="source"
          label="Source country"
          any="All source countries"
          countries={sideCountries(list.corridors, "source")}
          value={filters.source}
        />
        <FormButton type="submit" variant="secondary" className="w-auto">
          Apply filters
        </FormButton>
      </form>

      {destination ? (
        <p>
          <TextLink href={networkPath(lang, destination.destination_country)}>
            See the workforce network for {destination.destination_name}
          </TextLink>
        </p>
      ) : null}

      {shown.length === 0 ? (
        <div role="status">
          <EmptyState
            icon={Waypoints}
            title={filtered ? "No corridors match these countries" : "No corridors to show yet"}
            description={
              filtered
                ? "Try another country, or show every corridor."
                : `A corridor is shown once ${list.min_count} or more listed partners work in it.`
            }
          >
            {filtered ? (
              <TextLink standalone href={corridorsPath(lang)}>
                Show every corridor
              </TextLink>
            ) : null}
          </EmptyState>
        </div>
      ) : (
        <ul aria-label="Corridors" className="grid gap-3 md:grid-cols-2">
          {shown.map((row) => (
            <Card as="li" key={`${row.source_country}-${row.destination_country}`} padding="sm" className="gap-4">
              <h2 className="text-h3">
                <TextLink href={corridorPath(lang, row.source_country, row.destination_country)} tone="plain">
                  {row.source_name} <span aria-hidden>→</span>
                  <span className="sr-only">to</span> {row.destination_name}
                </TextLink>
              </h2>
              <CorridorFigures row={row} minCount={list.min_count} />
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
