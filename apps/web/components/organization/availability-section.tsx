"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { EmptyState } from "@/components/feedback/empty-state";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { StatusBadge } from "@/components/feedback/status-badge";
import { toast, toastError } from "@/components/feedback/toast-store";
import { useActionCall } from "@/components/feedback/use-action-call";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField } from "@/components/forms/form-field";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { confirmListing, deleteListing, saveListing } from "@/lib/actions/workforce-availability";
import type { ReferenceItem } from "@/lib/dal/reference";
import type { WorkforceListing } from "@/lib/dal/workforce-availability";
import { formatCount, formatDate } from "@/lib/i18n/format";
import { toOptions } from "@/lib/reference-options";
import { todayUtc } from "@/lib/validation/passport";
import {
  freshnessLabel,
  listingFormSchema,
  listingFreshness,
  listingsLimitMessage,
  type AvailabilityRules,
  type ListingInput,
} from "@/lib/validation/workforce-availability";

const SAVE_FAILED = "Could not save the listing";

const ids = {
  occupation: "listing-occupation",
  country: "listing-country",
  available: "listing-available",
  monthlyCapacity: "listing-capacity",
  availableFrom: "listing-from",
} as const;

type AvailabilitySectionProps = {
  slug: string;
  canManage: boolean;
  listings: WorkforceListing[];
  // The occupations and source countries of the partner's own profile: a listing names one of each.
  occupations: ReferenceItem[];
  countries: ReferenceItem[];
  rules: AvailabilityRules;
  limit: number | null;
  billingHref: string;
  now: string;
};

// The availability listings of a partner (FR-K3): per occupation and source country of its profile, the workers
// available now, the monthly capacity and the date from which they are available, each with the time it was last
// confirmed. The owner and admins add, change, confirm and delete listings; a member reads them. A listing not confirmed
// within the staleness period is hidden outside the company until it is confirmed again.
export function AvailabilitySection({
  slug,
  canManage,
  listings,
  occupations,
  countries,
  rules,
  limit,
  billingHref,
  now,
}: AvailabilitySectionProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<WorkforceListing | "new" | null>(null);
  const [deleting, setDeleting] = useState<WorkforceListing | null>(null);
  const occupationOf = (code: string) => occupations.find((item) => item.code === code)?.name ?? code;
  const countryOf = (code: string) => countries.find((item) => item.code === code)?.name ?? code;
  const nameOf = (listing: WorkforceListing) => `${occupationOf(listing.occupation)} from ${countryOf(listing.country)}`;
  const close = () => setEditing(null);
  const profileReady = occupations.length > 0 && countries.length > 0;
  const atLimit = limit !== null && listings.length >= limit;
  const addButton =
    canManage && profileReady && !atLimit ? (
      <FormButton type="button" className="w-full sm:w-auto" onClick={() => setEditing("new")}>
        Add a listing
      </FormButton>
    ) : null;
  const limitNotice =
    canManage && limit !== null ? (
      <p className="text-small">
        {formatCount(listings.length)} of {formatCount(limit)} {limit === 1 ? "listing" : "listings"}.{" "}
        {atLimit ? (
          <>
            {listingsLimitMessage(limit)} <TextLink href={billingHref}>Upgrade to add more.</TextLink>
          </>
        ) : null}
      </p>
    ) : null;

  return (
    <>
      {listings.length === 0 ? (
        <EmptyState
          title="No availability listed yet"
          description={
            !canManage
              ? "Your owner or an administrator lists the workers your company can supply."
              : profileReady
                ? "List how many workers you can supply now and each month, per occupation and source country."
                : "A listing names one of the occupations you offer and one of the countries you source workers from. Add them above first."
          }
        >
          {limitNotice}
          {addButton}
        </EmptyState>
      ) : (
        <>
          {addButton || limitNotice ? (
            <div className="grid gap-2">
              {limitNotice}
              {addButton ? <div>{addButton}</div> : null}
            </div>
          ) : null}
          <ul className="grid gap-4" aria-label="Availability listings">
            {listings.map((listing) => {
              const freshness = listingFreshness(listing.confirmedAt, new Date(now), rules);
              const { badge, text } = freshnessLabel(freshness, formatDate(listing.confirmedAt));
              return (
                <li key={listing.id} className="grid gap-3 rounded-xl border bg-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-h3 break-words">
                      {occupationOf(listing.occupation)}, {countryOf(listing.country)}
                    </h3>
                    {badge ? <StatusBadge status="warning">{badge}</StatusBadge> : null}
                  </div>
                  <p className="text-body">
                    {formatCount(listing.available)} available, {formatCount(listing.monthlyCapacity)} per month, from{" "}
                    {formatDate(listing.availableFrom)}
                  </p>
                  <p className="text-small text-muted-foreground">{text}</p>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      <ConfirmListing slug={slug} listing={listing} name={nameOf(listing)} onConfirmed={() => router.refresh()} />
                      <FormButton type="button" variant="secondary" onClick={() => setEditing(listing)}>
                        Edit<span className="sr-only"> the listing for {nameOf(listing)}</span>
                      </FormButton>
                      <FormButton type="button" variant="secondary" onClick={() => setDeleting(listing)}>
                        Delete<span className="sr-only"> the listing for {nameOf(listing)}</span>
                      </FormButton>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <ModalDialog open={editing !== null} onClose={close} title={editing === "new" ? "Add a listing" : "Edit the listing"}>
        {editing ? (
          <ListingForm
            slug={slug}
            listing={editing === "new" ? null : editing}
            occupations={occupations}
            countries={countries}
            maxDays={rules.maxDays}
            name={editing === "new" ? null : nameOf(editing)}
            onClose={close}
            onSaved={() => {
              close();
              router.refresh();
            }}
          />
        ) : null}
      </ModalDialog>
      <ModalDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete the listing for ${nameOf(deleting)}?` : ""}
      >
        {deleting ? (
          <DeleteListing slug={slug} listing={deleting} onClose={() => setDeleting(null)} onDeleted={() => router.refresh()} />
        ) : null}
      </ModalDialog>
    </>
  );
}

type ListingFormProps = {
  slug: string;
  listing: WorkforceListing | null;
  occupations: ReferenceItem[];
  countries: ReferenceItem[];
  maxDays: number;
  name: string | null;
  onClose: () => void;
  onSaved: () => void;
};

// A new listing chooses its occupation and source country from the profile; a saved one keeps them and changes its
// numbers and date. A failed save keeps the dialog open with every value.
function ListingForm({ slug, listing, occupations, countries, maxDays, name, onClose, onSaved }: ListingFormProps) {
  const form = useForm<ListingInput>({
    resolver: zodResolver(listingFormSchema({ occupations, countries, maxDays })),
    defaultValues: {
      occupation: listing?.occupation ?? "",
      country: listing?.country ?? "",
      available: listing ? String(listing.available) : "",
      monthlyCapacity: listing ? String(listing.monthlyCapacity) : "",
      availableFrom: listing?.availableFrom ?? todayUtc(),
    },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: SAVE_FAILED });

  function onSubmit() {
    return submit(
      () => saveListing(slug, listing?.id ?? null, form.getValues()),
      (result) => {
        if (result.saved) {
          onSaved();
          toast({ title: "Listing saved" });
        } else if (result.message) {
          toastError(SAVE_FAILED, result.message);
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
      {listing ? (
        <p className="text-body font-semibold">{name}</p>
      ) : (
        <>
          <ComboboxField
            control={control}
            name="occupation"
            id={ids.occupation}
            label="Occupation"
            description="One of the occupations you offer."
            placeholder="Choose an occupation"
            options={toOptions(occupations)}
            emptyText="No matching occupation"
          />
          <ComboboxField
            control={control}
            name="country"
            id={ids.country}
            label="Source country"
            description="One of the countries you source workers from."
            placeholder="Choose a country"
            options={toOptions(countries)}
            emptyText="No matching country"
          />
        </>
      )}
      <InputField
        control={control}
        name="available"
        id={ids.available}
        label="Workers available now"
        inputMode="numeric"
        autoComplete="off"
      />
      <InputField
        control={control}
        name="monthlyCapacity"
        id={ids.monthlyCapacity}
        label="Monthly capacity"
        description="How many more workers you can supply each month."
        inputMode="numeric"
        autoComplete="off"
      />
      <InputField
        control={control}
        name="availableFrom"
        id={ids.availableFrom}
        label="Available from"
        description="An earlier date is saved as today."
        type="date"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" disabled={formState.isSubmitting} onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={formState.isSubmitting}>
          {formState.isSubmitting ? "Saving..." : "Save listing"}
        </FormButton>
      </div>
    </form>
  );
}

type ConfirmListingProps = { slug: string; listing: WorkforceListing; name: string; onConfirmed: () => void };

function ConfirmListing({ slug, listing, name, onConfirmed }: ConfirmListingProps) {
  const confirm = useActionCall("Could not confirm the listing");
  return (
    <FormButton
      type="button"
      busy={confirm.pending}
      onClick={() => confirm.run(() => confirmListing(slug, listing.id), `Listing confirmed: ${name}`, onConfirmed)}
    >
      Confirm<span className="sr-only"> the listing for {name}</span>
    </FormButton>
  );
}

type DeleteListingProps = { slug: string; listing: WorkforceListing; onClose: () => void; onDeleted: () => void };

function DeleteListing({ slug, listing, onClose, onDeleted }: DeleteListingProps) {
  const remove = useActionCall("Could not delete the listing");
  return (
    <>
      <p className="text-body leading-relaxed">The listing is removed. This cannot be undone.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton
          type="button"
          variant="destructive"
          busy={remove.pending}
          onClick={() =>
            remove.run(
              () => deleteListing(slug, listing.id),
              "Listing deleted",
              () => {
                onClose();
                onDeleted();
              },
            )
          }
        >
          Delete listing
        </FormButton>
      </div>
    </>
  );
}
