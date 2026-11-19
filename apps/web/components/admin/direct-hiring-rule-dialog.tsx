"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast, toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { saveDirectHiringRule } from "@/lib/actions/direct-hiring-rules";
import {
  destinationText,
  emptyRuleForm,
  NOTICE_MAX,
  NOTICE_MIN,
  REFERENCE_MAX,
  RULE_UNCHANGED,
  ruleFormFrom,
  ruleFormSchema,
  ruleLabels,
  ruleValues,
  type DirectHiringRule,
  type RuleForm,
} from "@/lib/validation/direct-hiring-rules";

const FAILURE = "The rule was not saved";
const ruleOptions = ruleValues.map((value) => ({ value, label: ruleLabels[value] }));

type Country = { code: string; name: string };

// Adds a rule, or edits one (FR-Q5 AC1, AC10). The source and destination of an existing rule are its key and stay as they
// are; a rule for another pair is added instead, so only the add dialog needs the countries. A rule for a pair that
// already has one changes that rule.
export function DirectHiringRuleDialog({ countries = [], rule }: { countries?: readonly Country[]; rule?: DirectHiringRule }) {
  const [open, setOpen] = useState(false);
  const title = rule ? `Edit the rule for ${rule.sourceName}, ${destinationText(rule.destinationName)}` : "Add a rule";
  return (
    <>
      <FormButton type="button" variant={rule ? "secondary" : "primary"} className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        {rule ? (
          <>
            Edit<span className="sr-only"> the rule for {rule.sourceName}, {destinationText(rule.destinationName)}</span>
          </>
        ) : (
          "Add rule"
        )}
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title={title}>
        {open ? <RuleFormView countries={countries} rule={rule} onClose={() => setOpen(false)} /> : null}
      </ModalDialog>
    </>
  );
}

function RuleFormView({ countries, rule, onClose }: { countries: readonly Country[]; rule?: DirectHiringRule; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<RuleForm>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: rule ? ruleFormFrom(rule) : emptyRuleForm(),
    shouldFocusError: true,
  });
  const { control, formState, handleSubmit } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE });
  const prefix = rule ? `rule-${rule.id}` : "rule-new";
  const ids = {
    sourceCountry: `${prefix}-source`,
    destinationCountry: `${prefix}-destination`,
    rule: `${prefix}-rule`,
    notice: `${prefix}-notice`,
    legalOpinionRef: `${prefix}-reference`,
    reason: `${prefix}-reason`,
  };
  const countryOptions = countries.map(({ code, name }) => ({ value: code, label: name }));

  function onSubmit(values: RuleForm) {
    return submit(
      () => saveDirectHiringRule(values),
      (result) => {
        if (result.message && result.message !== RULE_UNCHANGED) toastError(FAILURE, result.message);
        if (!result.done) return;
        onClose();
        toast({ title: "The rule is saved" });
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <p className="text-small text-muted-foreground">
        Set a rule only after legal review. The notice is shown to employers and workers; the legal opinion reference is seen by
        administrators only. This is not legal advice to anyone.
      </p>
      <FormErrorSummary form={form} ids={ids} />
      {rule ? (
        <dl className="grid gap-1 text-body">
          <div>
            <dt className="inline font-medium">Source country: </dt>
            <dd className="inline">{rule.sourceName}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Destination: </dt>
            <dd className="inline">{destinationText(rule.destinationName)}</dd>
          </div>
        </dl>
      ) : (
        <>
          <SelectField
            control={control}
            name="sourceCountry"
            id={ids.sourceCountry}
            label="Source country"
            description="The country where the worker lives now, never a nationality."
            placeholder="Choose a country"
            options={countryOptions}
          />
          <SelectField
            control={control}
            name="destinationCountry"
            id={ids.destinationCountry}
            label="Destination country"
            description="Leave as all destinations for a rule that applies to every country of work."
            placeholder="All destinations"
            options={countryOptions}
          />
        </>
      )}
      <SelectField control={control} name="rule" id={ids.rule} label="Rule" placeholder="Choose a rule" options={ruleOptions} />
      <TextareaField
        control={control}
        name="notice"
        id={ids.notice}
        label="Notice"
        description={`Shown where the rule applies. ${NOTICE_MIN} to ${NOTICE_MAX.toLocaleString("en-GB")} characters, one paragraph.`}
      />
      <InputField
        control={control}
        name="legalOpinionRef"
        id={ids.legalOpinionRef}
        label="Legal opinion reference"
        description={`Required. The opinion this rule rests on, 1 to ${REFERENCE_MAX} characters.`}
        autoComplete="off"
        maxLength={REFERENCE_MAX}
      />
      <TextareaField control={control} name="reason" id={ids.reason} label="Reason for the change" description="Required, 10 to 500 characters." />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={formState.isSubmitting}>
          Save rule
        </FormButton>
      </div>
    </form>
  );
}
