"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { EmptyState } from "@/components/feedback/empty-state";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { StatusBadge } from "@/components/feedback/status-badge";
import { toast, toastError } from "@/components/feedback/toast-store";
import { useActionCall } from "@/components/feedback/use-action-call";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { ConfirmListing } from "@/components/organization/confirm-listing";
import { deleteListing, saveListing } from "@/lib/actions/workforce-availability";
import type { UsagePrompt } from "@/lib/billing/limits";
import type { ReferenceItem } from "@/lib/dal/reference";
import type { WorkforceListing } from "@/lib/dal/workforce-availability";
import { formatCount, formatDate } from "@/lib/i18n/format";
import { toOptions } from "@/lib/reference-options";
import { todayUtc } from "@/lib/validation/passport";
import { cefrLevels, SKILL_CERTIFICATES_MAX, skillsText } from "@/lib/workforce/skills";
import type { PartnerType } from "@/lib/validation/sign-up";
import {
  freshnessLabel,
  listingFormSchema,
  listingFreshness,
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
  languageCode: "listing-language",
  languageLevel: "listing-language-level",
  minExperienceYears: "listing-min-experience",
  certificates: "listing-certificates",
} as const;

type AvailabilitySectionProps = {
  slug: string;
  organizationId: string;
  partnerType: PartnerType;
  canManage: boolean;
  listings: WorkforceListing[];
  // The occupations and source countries of the partner's own profile: a listing names one of each.
  occupations: ReferenceItem[];
  countries: ReferenceItem[];
  // The languages a listing may name for its workers' level.
  languages: ReferenceItem[];
  rules: AvailabilityRules;
  // The listings limit when it applies.
  prompt: UsagePrompt | null;
  billingHref: string;
  now: string;
};

// The availability listings of a partner (FR-K3): per occupation and source country of its profile, the workers
// available now, the monthly capacity and the date from which they are available, each with the time it was last
// confirmed. The owner and admins add, change, confirm and delete listings; a member reads them. A listing not confirmed
// within the staleness period is hidden outside the company until it is confirmed again.
export function AvailabilitySection({
  slug,
  organizationId,
  partnerType,
  canManage,
  listings,
  occupations,
  countries,
  languages,
  rules,
  prompt,
  billingHref,
  now,
}: AvailabilitySectionProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<WorkforceListing | "new" | null>(null);
  const [deleting, setDeleting] = useState<WorkforceListing | null>(null);
  const occupationOf = (code: string) => occupations.find((item) => item.code === code)?.name ?? code;
  const countryOf = (code: string) => countries.find((item) => item.code === code)?.name ?? code;
  const skillsOf = (listing: WorkforceListing) =>
    skillsText({
      language: listing.languageCode ? (languages.find((item) => item.code === listing.languageCode)?.name ?? listing.languageCode) : null,
      languageLevel: listing.languageLevel,
      minExperienceYears: listing.minExperienceYears,
      certificates: listing.certificates,
    });
  const nameOf = (listing: WorkforceListing) => `${occupationOf(listing.occupation)} from ${countryOf(listing.country)}`;
  const close = () => setEditing(null);
  const profileReady = occupations.length > 0 && countries.length > 0;
  const limit = prompt?.limit ?? null;
  const atLimit = limit !== null && listings.length >= limit;
  const addButton =
    canManage && profileReady && !atLimit ? (
      <FormButton type="button" className="w-full sm:w-auto" onClick={() => setEditing("new")}>
        Add a listing
      </FormButton>
    ) : null;
  const limitNotice =
    canManage && prompt ? (
      atLimit ? (
        <UpgradePrompt
          organizationId={organizationId}
          organizationType={partnerType}
          prompt={{ ...prompt, used: listings.length }}
          billingHref={billingHref}
          canUpgrade
        />
      ) : (
        <p className="text-small">
          {formatCount(listings.length)} of {formatCount(prompt.limit)} {prompt.limit === 1 ? "listing" : "listings"}.
        </p>
      )
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
                ? words[partnerType].empty
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
              const { badge, text } = freshnessLabel(freshness, listing.confirmedAt, new Date(now));
              return (
                <li key={listing.id} className="grid gap-3 rounded-xl border bg-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-h3 break-words">
                      {occupationOf(listing.occupation)}, {countryOf(listing.country)}
                    </h3>
                    {badge ? <StatusBadge status="warning">{badge}</StatusBadge> : null}
                  </div>
                  <p className="text-body">
                    {formatCount(listing.available)} {words[partnerType].line}, {formatCount(listing.monthlyCapacity)} per month, from{" "}
                    {formatDate(listing.availableFrom)}
                  </p>
                  {skillsOf(listing) ? <p className="text-body break-words">{skillsOf(listing)}</p> : null}
                  <p className="text-small text-muted-foreground">{text}</p>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      {freshness.state === "fresh" ? null : <ConfirmListing slug={slug} listing={listing} name={nameOf(listing)} />}
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
      <ModalDialog wide open={editing !== null} onClose={close} title={editing === "new" ? "Add a listing" : "Edit the listing"}>
        {editing ? (
          <ListingForm
            partnerType={partnerType}
            slug={slug}
            listing={editing === "new" ? null : editing}
            occupations={occupations}
            countries={countries}
            languages={languages}
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

// A recruitment company lists the candidates it can put forward and recruit per month; a staffing company the workers on its
// own payroll it can supply. The listing is the same row either way.
const words = {
  recruitment_company: {
    available: "Candidates ready to present",
    monthly: "Candidates recruited per month",
    intro: "How many screened candidates you can put forward now and recruit each month, for one occupation and source country.",
    line: "candidates ready",
    empty: "List how many candidates you can put forward now and recruit each month, per occupation and source country.",
  },
  staffing_company: {
    available: "Workers available now",
    monthly: "More workers per month",
    intro: "How many workers on your payroll you can supply now and each month, for one occupation and source country.",
    line: "available",
    empty: "List how many workers you can supply now and each month, per occupation and source country.",
  },
} as const satisfies Record<PartnerType, Record<string, string>>;

type ListingFormProps = {
  partnerType: PartnerType;
  slug: string;
  listing: WorkforceListing | null;
  occupations: ReferenceItem[];
  countries: ReferenceItem[];
  languages: ReferenceItem[];
  maxDays: number;
  name: string | null;
  onClose: () => void;
  onSaved: () => void;
};

// A new listing chooses its occupation and source country from the profile; a saved one keeps them and changes its
// numbers and date. A failed save keeps the dialog open with every value.
function ListingForm({ partnerType, slug, listing, occupations, countries, languages, maxDays, name, onClose, onSaved }: ListingFormProps) {
  const form = useForm<ListingInput>({
    resolver: zodResolver(listingFormSchema({ occupations, countries, maxDays })),
    defaultValues: {
      occupation: listing?.occupation ?? "",
      country: listing?.country ?? "",
      available: listing ? String(listing.available) : "",
      monthlyCapacity: listing ? String(listing.monthlyCapacity) : "",
      availableFrom: listing?.availableFrom ?? todayUtc(),
      languageCode: listing?.languageCode ?? "",
      languageLevel: listing?.languageLevel ?? "",
      minExperienceYears: listing?.minExperienceYears == null ? "" : String(listing.minExperienceYears),
      certificates: listing?.certificates ?? "",
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
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onSubmit)}>
      <p className="-mt-2 text-body leading-relaxed text-muted-foreground">
        {listing ? name : words[partnerType].intro}
      </p>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
      <div className="grid gap-5 sm:grid-cols-2 sm:items-start">
        {listing ? null : (
          <>
            <ComboboxField
              control={control}
              name="occupation"
              id={ids.occupation}
              label="Occupation"
              placeholder="Choose an occupation"
              options={toOptions(occupations)}
              emptyText="No matching occupation"
            />
            <ComboboxField
              control={control}
              name="country"
              id={ids.country}
              label="Source country"
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
          label={words[partnerType].available}
          placeholder="For example, 40"
          inputMode="numeric"
          autoComplete="off"
        />
        <InputField
          control={control}
          name="monthlyCapacity"
          id={ids.monthlyCapacity}
          label={words[partnerType].monthly}
          placeholder="For example, 10"
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
      </div>
      <fieldset className="grid gap-5 rounded-xl border bg-secondary/40 p-4 sm:grid-cols-2 sm:items-start sm:p-5">
        <legend className="float-start mb-1 text-body font-semibold sm:col-span-2">
          The workers&apos; skills <span className="font-normal text-muted-foreground">(optional)</span>
        </legend>
        <ComboboxField
          control={control}
          name="languageCode"
          id={ids.languageCode}
          label="Language"
          placeholder="Choose a language"
          options={toOptions(languages)}
          emptyText="No matching language"
        />
        <SelectField
          control={control}
          name="languageLevel"
          id={ids.languageLevel}
          label="Level, at least"
          placeholder="Choose a level"
          options={cefrLevels.map((level) => ({ value: level, label: level }))}
        />
        <InputField
          control={control}
          name="minExperienceYears"
          id={ids.minExperienceYears}
          label="Experience, at least (years)"
          placeholder="For example, 3"
          inputMode="numeric"
          autoComplete="off"
        />
        <div className="sm:col-span-2">
          <TextareaField
            control={control}
            name="certificates"
            id={ids.certificates}
            label="Certificates and tests"
            description={`For example "ISO 9606-1 welders, 3G and 6G, trade-tested". Up to ${formatCount(SKILL_CERTIFICATES_MAX)} characters.`}
          />
        </div>
      </fieldset>
      <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
        <FormButton type="button" variant="secondary" className="sm:w-auto" disabled={formState.isSubmitting} onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" className="sm:w-auto sm:min-w-40" busy={formState.isSubmitting}>
          {formState.isSubmitting ? "Saving..." : "Save listing"}
        </FormButton>
      </div>
    </form>
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
