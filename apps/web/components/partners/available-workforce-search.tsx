"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { toastError } from "@/components/feedback/toast-store";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { searchAvailableWorkforce } from "@/lib/actions/available-workforce";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import { formatCount, formatDate } from "@/lib/i18n/format";
import {
  availableWorkforceSchema,
  type AvailableWorkforceInput,
  type WorkforceListing,
  type WorkforceSupplier,
} from "@/lib/partners/available-workforce";
import { toOptions } from "@/lib/reference-options";
import { partnerProfilePath } from "@/lib/routes";
import { confirmedAgo } from "@/lib/validation/workforce-availability";

const FAILURE_TITLE = "The available workforce could not be searched";

const ids = {
  occupation: "workforce-occupation",
  destination: "workforce-destination",
  workers: "workforce-workers",
  within_days: "workforce-within-days",
} as const;

type Outcome =
  // focusFrom is the first card of a page added by Show more partners, which takes the focus once it is shown.
  | {
      state: "found";
      suppliers: WorkforceSupplier[];
      nextCursor: string | null;
      values: AvailableWorkforceInput;
      focusFrom: number | null;
    }
  | { state: "not_in_plan" }
  | { state: "rate_limited" };

function withinDaysText(values: AvailableWorkforceInput): string {
  const days = Number(values.within_days);
  return `${formatCount(days)} ${days === 1 ? "day" : "days"}`;
}

function ListingLine({ listing, now }: { listing: WorkforceListing; now: Date }) {
  const from = new Date(`${listing.availableFrom}T00:00:00Z`) > now ? `, from ${formatDate(listing.availableFrom)}` : ", available now";
  return (
    <li>
      {listing.sourceCountry}: {formatCount(listing.available)} available, {formatCount(listing.monthlyCapacity)} per month{from}.{" "}
      <span className="text-muted-foreground">
        <time dateTime={listing.confirmedAt}>{confirmedAgo(listing.confirmedAt, now)}</time>
      </span>
    </li>
  );
}

// A partner that can supply the number in time, with the listings that count and when each was last confirmed (FR-K3
// AC9). No badge, score or plan [d1.1].
function SupplierCard({ lang, supplier, now }: { lang: string; supplier: WorkforceSupplier; now: Date }) {
  return (
    <li className="grid gap-1 py-5">
      <h3 className="text-h3">
        <TextLink href={partnerProfilePath(lang, supplier.slug)} className="break-words">
          {supplier.displayName}
        </TextLink>
      </h3>
      {supplier.recruitmentCompany ? <p className="text-small text-muted-foreground">Recruitment company</p> : null}
      <p className="text-body">
        {formatCount(supplier.availableNow)} available now, {formatCount(supplier.supply)} within the timeframe
      </p>
      <ul className="grid gap-1 text-body">
        {supplier.listings.map((listing) => (
          <ListingLine key={listing.sourceCountry} listing={listing} now={now} />
        ))}
      </ul>
    </li>
  );
}

// The Available workforce search of an employer (FR-K3 step Search, AC9): every field keeps a visible label, a skeleton
// shows while searching, a failure toasts and keeps the inputs. The partners that cover the number with workers
// available now come first, then the most recently confirmed; no partner pays to rank higher.
export function AvailableWorkforceSearch({
  lang,
  occupations,
  countries,
}: {
  lang: string;
  occupations: OccupationItem[];
  countries: ReferenceItem[];
}) {
  const form = useForm<AvailableWorkforceInput>({
    resolver: zodResolver(availableWorkforceSchema),
    defaultValues: { occupation: "", destination: "", workers: "", within_days: "" },
  });
  const { control, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: FAILURE_TITLE });
  const [searching, startSearch] = useTransition();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [loadingMore, setLoadingMore] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (outcome?.state !== "found" || outcome.focusFrom === null) return;
    listRef.current?.querySelectorAll<HTMLAnchorElement>(":scope > li > h3 a")[outcome.focusFrom]?.focus();
  }, [outcome]);

  function run(values: AvailableWorkforceInput, cursor: string | null) {
    const shown = outcome?.state === "found" ? outcome.suppliers.length : 0;
    setLoadingMore(cursor !== null);
    startSearch(() =>
      submit(
        () => searchAvailableWorkforce(values, cursor),
        ({ page, refused, failure }) => {
          if (failure) toastError(FAILURE_TITLE, failure);
          if (refused) setOutcome({ state: refused });
          if (!page) return;
          setNow(new Date());
          setOutcome((previous) => ({
            state: "found",
            suppliers: [...(cursor && previous?.state === "found" ? previous.suppliers : []), ...page.suppliers],
            nextCursor: page.nextCursor,
            values,
            focusFrom: cursor ? shown : null,
          }));
        },
      ),
    );
  }

  return (
    <section aria-labelledby="available-workforce-heading" className="grid gap-5 rounded-xl border bg-card p-5 sm:p-6">
      <div className="grid gap-1">
        <h2 id="available-workforce-heading" className="text-h2">
          Available workforce
        </h2>
        <p className="text-body text-muted-foreground">
          Who can supply your workers in time. Only listings confirmed recently count; monthly capacity counts pro rata.
          Partners who have all the workers available now come first, then the most recently confirmed.
        </p>
      </div>
      <form noValidate aria-label="Search available workforce" className="grid gap-4" onSubmit={handleSubmit((values) => run(values, null))}>
        <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ComboboxField
            control={control}
            name="occupation"
            id={ids.occupation}
            label="Occupation"
            placeholder="Choose an occupation"
            emptyText="No matching occupation"
            options={occupations.map(({ code, label, synonyms }) => ({
              value: code,
              label,
              keywords: [code, ...synonyms].join(" "),
            }))}
          />
          <ComboboxField
            control={control}
            name="destination"
            id={ids.destination}
            label="Destination"
            placeholder="Choose a country"
            emptyText="No matching country"
            options={toOptions(countries)}
          />
          <InputField control={control} name="workers" id={ids.workers} label="Workers needed" inputMode="numeric" />
          <InputField control={control} name="within_days" id={ids.within_days} label="Within (days)" inputMode="numeric" />
        </div>
        <FormButton type="submit" busy={searching} className="w-auto self-start sm:px-8">
          {searching ? "Searching..." : "Search available workforce"}
        </FormButton>
      </form>

      {searching && !loadingMore ? (
        <LoadingSkeleton rows={3} />
      ) : outcome?.state === "not_in_plan" ? (
        <Notice tone="warning" role="alert">
          <p className="font-semibold">The available workforce search needs a paid employer plan.</p>
        </Notice>
      ) : outcome?.state === "rate_limited" ? (
        <Notice tone="warning" role="alert">
          <p className="font-semibold">Too many searches. Please wait a minute and try again.</p>
        </Notice>
      ) : outcome?.state === "found" && outcome.suppliers.length === 0 ? (
        <div role="status">
          <EmptyState
            title={`No partner can supply this within ${withinDaysText(outcome.values)}`}
            description="Try a longer timeframe or fewer workers."
          />
        </div>
      ) : outcome?.state === "found" ? (
        <div className="grid gap-3">
          <p role="status" aria-live="polite" className="text-body text-muted-foreground">
            {outcome.suppliers.length} {outcome.suppliers.length === 1 ? "partner can" : "partners can"} supply this
            {outcome.nextCursor ? ", more on request" : ""}
          </p>
          <ul ref={listRef} aria-label="Partners with available workforce" className="divide-y border-y">
            {outcome.suppliers.map((supplier) => (
              <SupplierCard key={supplier.id} lang={lang} supplier={supplier} now={now} />
            ))}
          </ul>
          {searching ? (
            <LoadingSkeleton rows={1} />
          ) : outcome.nextCursor ? (
            <FormButton
              type="button"
              variant="secondary"
              className="w-auto self-start"
              onClick={() => run(outcome.values, outcome.nextCursor)}
            >
              Show more partners
            </FormButton>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
