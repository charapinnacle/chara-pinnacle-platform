"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileCheck, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import * as z from "zod";
import { EmptyState } from "@/components/feedback/empty-state";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { StatusBadge } from "@/components/feedback/status-badge";
import { toast, toastError } from "@/components/feedback/toast-store";
import { useActionCall } from "@/components/feedback/use-action-call";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { FormField, InputField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { deleteLicence, getEvidenceDownload, saveLicence, startEvidenceUpload } from "@/lib/actions/licences";
import { BRAND_NAME } from "@/lib/brand";
import type { PartnerLicence } from "@/lib/dal/licences";
import type { ReferenceItem } from "@/lib/dal/reference";
import { USABLE_SCAN_STATUSES, formatFileSize } from "@/lib/documents/presentation";
import { formatDate } from "@/lib/i18n/format";
import { toOptions } from "@/lib/reference-options";
import { createLazyClient } from "@/lib/supabase/lazy-browser";
import { cn } from "@/lib/utils";
import {
  LICENCE_STAFF_ONLY,
  evidenceAccept,
  evidenceFormSchema,
  evidenceStatusLabels,
  licenceFormSchema,
  type LicenceInput,
} from "@/lib/validation/licences";

const EVIDENCE_BUCKET = "partner-documents";
const SAVE_FAILED = "Could not save the licence";
const FILE_NOT_SENT = "The licence is saved, but the file was not sent. Edit the licence to upload the file again.";

const ids = {
  country: "licence-country",
  issuingAuthority: "licence-authority",
  licenceNumber: "licence-number",
  validUntil: "licence-valid-until",
  file: "licence-file",
  confirmed: "licence-confirmed",
} as const;

type LicencesSectionProps = {
  slug: string;
  canManage: boolean;
  licences: PartnerLicence[];
  countries: ReferenceItem[];
  patterns: Record<string, string>;
  maxYears: number;
  // A country to open the form for at once, from the licence prompt of Where you serve (FR-K1 AC8), and the page to
  // return to without it once the form closes.
  initialCountry?: string | null;
  profilePath?: string;
};

type FormValues = LicenceInput & { file?: File };
type Outcome = { errors?: Record<string, string>; message?: string; saved?: true; fileNotSent?: string };

// The licences of a partner (FR-J2): one entry per country with the issuing authority, the number, the valid-until date
// and an optional evidence file. The owner and admins add, change and delete entries; a member reads them. They are kept
// for staff review and never shown to employers or the public until verification exists [d2.6].
export function LicencesSection({
  slug,
  canManage,
  licences,
  countries,
  patterns,
  maxYears,
  initialCountry,
  profilePath,
}: LicencesSectionProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<PartnerLicence | "new" | null>(canManage && initialCountry ? "new" : null);
  const [deleting, setDeleting] = useState<PartnerLicence | null>(null);
  const nameOf = (code: string) => countries.find((country) => country.code === code)?.name ?? code;
  const close = () => {
    setEditing(null);
    if (initialCountry && profilePath) router.replace(profilePath, { scroll: false });
  };
  const addButton = canManage ? (
    <FormButton type="button" className="w-full sm:w-auto" onClick={() => setEditing("new")}>
      Add a licence
    </FormButton>
  ) : null;

  return (
    <>
      {licences.length === 0 ? (
        <EmptyState
          flat
          title="No licences added yet"
          description={
            canManage
              ? "Add one for each country you work in."
              : "Your owner or an administrator adds the licences of your company."
          }
        >
          {addButton}
        </EmptyState>
      ) : (
        <>
          {addButton ? <div>{addButton}</div> : null}
          <ul className="grid gap-4" aria-label="Licences">
            {licences.map((licence) => (
              <li key={licence.id} className="grid gap-3 rounded-xl border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-h3 break-words">{nameOf(licence.country)}</h3>
                  {licence.status === "expired" ? <StatusBadge status="danger">Expired</StatusBadge> : null}
                </div>
                <dl className="grid gap-2 text-body sm:grid-cols-[max-content_1fr] sm:gap-x-6">
                  <dt className="text-small font-semibold">Issuing authority</dt>
                  <dd className="break-words">{licence.issuingAuthority}</dd>
                  <dt className="text-small font-semibold">Licence or registration number</dt>
                  <dd className="break-all">{licence.licenceNumber}</dd>
                  <dt className="text-small font-semibold">Valid until</dt>
                  <dd>{formatDate(licence.validUntil)}</dd>
                  <dt className="text-small font-semibold">Supporting document</dt>
                  <dd>
                    {licence.evidence
                      ? `${formatFileSize(licence.evidence.sizeBytes)} - ${evidenceStatusLabels[licence.evidence.status]}`
                      : "None"}
                  </dd>
                </dl>
                <p className="text-small text-muted-foreground">{LICENCE_STAFF_ONLY}</p>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    {licence.evidence && (USABLE_SCAN_STATUSES as readonly string[]).includes(licence.evidence.status) ? (
                      <DownloadEvidence slug={slug} licenceId={licence.id} country={nameOf(licence.country)} />
                    ) : null}
                    <FormButton type="button" variant="secondary" onClick={() => setEditing(licence)}>
                      Edit<span className="sr-only"> the licence for {nameOf(licence.country)}</span>
                    </FormButton>
                    <FormButton type="button" variant="secondary" onClick={() => setDeleting(licence)}>
                      Delete<span className="sr-only"> the licence for {nameOf(licence.country)}</span>
                    </FormButton>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
      <ModalDialog wide open={editing !== null} onClose={close} title={editing === "new" ? "Add a licence" : "Edit the licence"}>
        {editing ? (
          <LicenceForm
            slug={slug}
            licence={editing === "new" ? null : editing}
            initialCountry={editing === "new" ? initialCountry : null}
            countries={countries}
            patterns={patterns}
            maxYears={maxYears}
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
        title={deleting ? `Delete the licence for ${nameOf(deleting.country)}?` : ""}
      >
        {deleting ? (
          <DeleteLicence
            slug={slug}
            licence={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={() => router.refresh()}
          />
        ) : null}
      </ModalDialog>
    </>
  );
}

type LicenceFormProps = {
  slug: string;
  licence: PartnerLicence | null;
  initialCountry?: string | null;
  countries: ReferenceItem[];
  patterns: Record<string, string>;
  maxYears: number;
  onClose: () => void;
  onSaved: () => void;
};

// A failed save keeps the dialog open with every value; the file is sent only after the entry is saved, straight to
// Storage through the URL the Server Action obtained.
function LicenceForm({ slug, licence, initialCountry, countries, patterns, maxYears, onClose, onSaved }: LicenceFormProps) {
  const schema = licenceFormSchema({ countries, patterns, maxYears, savedValidUntil: licence?.validUntil }).and(
    z.object({ file: evidenceFormSchema }),
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      country: licence?.country ?? initialCountry ?? "",
      issuingAuthority: licence?.issuingAuthority ?? "",
      licenceNumber: licence?.licenceNumber ?? "",
      validUntil: licence?.validUntil ?? "",
      confirmed: false,
      file: undefined,
    },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const file = useWatch({ control, name: "file" });
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: SAVE_FAILED });

  function onSubmit() {
    return submit(
      async (): Promise<Outcome> => {
        const { file, ...values } = form.getValues();
        const saved = await saveLicence(slug, licence?.id ?? null, values);
        if (!saved.licenceId) return saved;
        if (!file) return { saved: true };
        const started = await startEvidenceUpload(slug, saved.licenceId, { name: file.name, size: file.size, type: file.type });
        if (!started.upload) return { fileNotSent: started.message ?? FILE_NOT_SENT };
        const supabase = await createLazyClient();
        const { error } = await supabase.storage
          .from(EVIDENCE_BUCKET)
          .uploadToSignedUrl(started.upload.path, started.upload.token, file, { contentType: file.type });
        return error ? { fileNotSent: FILE_NOT_SENT } : { saved: true };
      },
      (result) => {
        if (result.saved) {
          onSaved();
          toast({ title: "Licence saved" });
        } else if (result.fileNotSent) {
          onSaved();
          toastError("The file was not sent", result.fileNotSent);
        } else if (result.message) {
          toastError(SAVE_FAILED, result.message);
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onSubmit)}>
      <p className="-mt-2 text-body leading-relaxed text-muted-foreground">
        The licence or registration your company holds in one country. {LICENCE_STAFF_ONLY}.
      </p>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
      <div className="grid gap-5 sm:grid-cols-2 sm:items-start">
        <ComboboxField
          control={control}
          name="country"
          id={ids.country}
          label="Country"
          placeholder="Choose a country"
          options={toOptions(countries)}
          emptyText="No matching country"
        />
        <InputField control={control} name="validUntil" id={ids.validUntil} label="Valid until" type="date" />
        <InputField
          control={control}
          name="issuingAuthority"
          id={ids.issuingAuthority}
          label="Issuing authority"
          placeholder="For example, the labour ministry"
        />
        <InputField
          control={control}
          name="licenceNumber"
          id={ids.licenceNumber}
          label="Licence or registration number"
          autoComplete="off"
        />
      </div>
      <FormField
        control={control}
        name="file"
        id={ids.file}
        label="Supporting document (optional)"
        description={
          licence?.evidence
            ? `PDF, JPG or PNG, up to 15 MB. A new file replaces the current one. Only ${BRAND_NAME} staff open it.`
            : `PDF, JPG or PNG, up to 15 MB. Only ${BRAND_NAME} staff open it.`
        }
      >
        {(field) => (
          <div
            className={cn(
              "relative flex min-h-24 items-center gap-4 rounded-xl border border-dashed border-input bg-secondary/40 px-4 py-4 transition-colors hover:border-muted-foreground has-focus-visible:border-primary has-focus-visible:ring-2 has-focus-visible:ring-ring",
              field["aria-invalid"] && "border-destructive",
            )}
          >
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border bg-card">
              {file ? <FileCheck className="size-5" /> : <Upload className="size-5 text-muted-foreground" />}
            </span>
            <span aria-hidden className="grid min-w-0 gap-0.5">
              <span className="truncate text-body font-medium">
                {file ? file.name : licence?.evidence ? "Current document kept" : "Choose a file or drop it here"}
              </span>
              <span className="text-small text-muted-foreground">
                {file
                  ? `${formatFileSize(file.size)} · choose again to replace it`
                  : licence?.evidence
                    ? `${formatFileSize(licence.evidence.sizeBytes)} · choose a file to replace it`
                    : "Click to browse your files"}
              </span>
            </span>
            {/* The native input covers the box, so a click or a dropped file reaches it and its label stays its name. */}
            <input
              type="file"
              id={field.id}
              name={field.name}
              ref={field.ref}
              accept={evidenceAccept}
              aria-invalid={field["aria-invalid"]}
              aria-describedby={field["aria-describedby"]}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
              onBlur={field.onBlur}
              onChange={(event) => field.onChange(event.target.files?.[0])}
            />
          </div>
        )}
      </FormField>
      <div className="rounded-xl border bg-secondary/40 px-4">
        <CheckboxField control={control} name="confirmed" id={ids.confirmed}>
          I confirm that this entry is accurate
        </CheckboxField>
      </div>
      <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
        <FormButton type="button" variant="secondary" className="sm:w-auto" disabled={formState.isSubmitting} onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" className="sm:w-auto sm:min-w-40" busy={formState.isSubmitting}>
          {formState.isSubmitting ? "Saving..." : "Save licence"}
        </FormButton>
      </div>
    </form>
  );
}

function DownloadEvidence({ slug, licenceId, country }: { slug: string; licenceId: string; country: string }) {
  const download = useActionCall("Could not download the file");
  return (
    <FormButton
      type="button"
      variant="secondary"
      busy={download.pending}
      onClick={() =>
        download.run(async () => {
          const result = await getEvidenceDownload(slug, licenceId);
          if (result.url) window.location.assign(result.url);
          return result;
        }, "Your download is starting")
      }
    >
      Download<span className="sr-only"> the document for {country}</span>
    </FormButton>
  );
}

type DeleteLicenceProps = { slug: string; licence: PartnerLicence; onClose: () => void; onDeleted: () => void };

function DeleteLicence({ slug, licence, onClose, onDeleted }: DeleteLicenceProps) {
  const remove = useActionCall("Could not delete the licence");
  return (
    <>
      <p className="text-body leading-relaxed">
        The entry is removed now. Its supporting document is kept out of reach for the retention period of replaced evidence, then
        deleted. This cannot be undone.
      </p>
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
              () => deleteLicence(slug, licence.id),
              "Licence deleted",
              () => {
                onClose();
                onDeleted();
              },
            )
          }
        >
          Delete licence
        </FormButton>
      </div>
    </>
  );
}
