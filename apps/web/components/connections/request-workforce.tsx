"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { AgencyWorkNotice } from "@/components/compliance/agency-work-notice";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast } from "@/components/feedback/toast-store";
import { ComboboxField } from "@/components/forms/combobox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { requestWorkforce } from "@/lib/actions/connection-actions";
import { agencyWorkRulesFor, type AgencyWorkRule } from "@/lib/compliance/agency-work";
import { characterCount } from "@/lib/i18n/format";
import { characters } from "@/lib/utils";
import {
  NOTE_MAX,
  workforceRequestFormSchema,
  type WorkforceRequestFormInput,
  type WorkforceRequestFormOutput,
} from "@/lib/validation/connection-actions";

const IDS = {
  occupation: "workforce-occupation",
  quantity: "workforce-quantity",
  destination: "workforce-destination",
  cityRegion: "workforce-city",
  startDate: "workforce-start",
  body: "workforce-body",
};

type Option = { value: string; label: string };

type RequestWorkforceProps = {
  slug: string;
  partnerId: string;
  partnerName: string;
  occupations: readonly Option[];
  countries: readonly Option[];
  defaultDestination: string;
  // The agency-work rules that may concern this partner's workers; the dialog shows those of the country of work chosen.
  agencyWorkRules: readonly AgencyWorkRule[];
};

// "Request workforce" on the public profile of a staffing partner, for an employer's owners and admins (FR-P2 AC3, AC9;
// SOP step Request workforce): one occupation, how many workers, where and from when. The platform writes a private
// draft requirement and invites the partner to it; the employer completes and publishes it later (FR-M1).
export function RequestWorkforce(props: RequestWorkforceProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        Request workforce<span className="sr-only normal-case"> from {props.partnerName}</span>
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title={`Request workforce from ${props.partnerName}`}>
        <RequestForm {...props} onClose={() => setOpen(false)} />
      </ModalDialog>
    </>
  );
}

function RequestForm({
  slug,
  partnerId,
  partnerName,
  occupations,
  countries,
  defaultDestination,
  agencyWorkRules,
  onClose,
}: RequestWorkforceProps & { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const form = useForm<WorkforceRequestFormInput, undefined, WorkforceRequestFormOutput>({
    resolver: zodResolver(workforceRequestFormSchema()),
    defaultValues: { occupation: "", quantity: "", destination: defaultDestination, cityRegion: "", startDate: "", body: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The workforce request was not sent" });
  const length = characters(useWatch({ control, name: "body" }));
  const destination = useWatch({ control, name: "destination" });

  function onSubmit(values: WorkforceRequestFormOutput) {
    return submit(
      () => requestWorkforce(slug, partnerId, values, pathname),
      (result) => {
        if (!result.done) return;
        onClose();
        toast({
          title: "Workforce request sent",
          description: "A draft requirement was created. Complete and publish it so the partner can respond.",
        });
        router.push(result.done.href);
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={IDS} />
      <p className="text-body leading-relaxed">
        {partnerName} is invited to a private draft requirement with these details and sees your organisation&apos;s name. It
        can reply in the conversation and responds once you publish the requirement.
      </p>
      <ComboboxField
        control={control}
        name="occupation"
        id={IDS.occupation}
        label="Occupation"
        placeholder="Select an occupation"
        options={occupations}
        emptyText="No matching occupation"
      />
      <InputField control={control} name="quantity" id={IDS.quantity} label="Number of workers" inputMode="numeric" />
      <ComboboxField
        control={control}
        name="destination"
        id={IDS.destination}
        label="Country of work"
        placeholder="Select a country"
        options={countries}
        emptyText="No matching country"
      />
      <AgencyWorkNotice rules={agencyWorkRulesFor(agencyWorkRules, destination)} />
      <InputField control={control} name="cityRegion" id={IDS.cityRegion} label="City or region" maxLength={100} />
      <InputField control={control} name="startDate" id={IDS.startDate} label="Start date" type="date" />
      <TextareaField
        control={control}
        name="body"
        id={IDS.body}
        label="Message (optional)"
        description={`${characterCount(length, NOTE_MAX)}`}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={formState.isSubmitting}>
          Send request
        </FormButton>
      </div>
    </form>
  );
}
