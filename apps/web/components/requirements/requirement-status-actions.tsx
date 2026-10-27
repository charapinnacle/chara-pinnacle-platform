"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, CircleCheck, Lock, Store } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast } from "@/components/feedback/toast-store";
import { useActionCall } from "@/components/feedback/use-action-call";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { Notice } from "@/components/forms/notice";
import { RadioGroupField } from "@/components/forms/radio-group-field";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { changeRequirementStatus, extendRequirement, publishRequirement, type RequirementStatusResult } from "@/lib/actions/requirements";
import type { UsagePrompt } from "@/lib/billing/limits";
import { formatDate } from "@/lib/i18n/format";
import { extendLabel, requirementActions, requirementClosesOn, type RequirementAction } from "@/lib/requirements/lifecycle";
import { multiCountryText } from "@/lib/requirements/limits";
import {
  closeFormSchema,
  publishFormSchema,
  requirementVisibilityLabels,
  type CloseFormInput,
  type PublishFormInput,
  type RequirementTarget,
} from "@/lib/validation/requirement-status";
import type { Database } from "@chara-pinnacle/db-types";

type RequirementStatusActionsProps = {
  organizationId: string;
  slug: string;
  billingHref: string;
  target: RequirementTarget;
  status: Database["public"]["Enums"]["requirement_status"];
  startDate: string;
  today: string;
  openDays: number;
  extensionDays: number;
};

type Dialog = "publish" | "close" | "fill";

// What the plan refused for the last publish or reopen (FR-M4 AC9): the open-requirements limit with its usage, or
// several destinations with the plan that has them. Local state, since it belongs to that attempt.
type PlanRefusal = { kind: "limit"; prompt: UsagePrompt } | { kind: "feature"; planName: string | null };

function planRefusalOf(result: RequirementStatusResult): PlanRefusal | null {
  if (result.limitReached) return { kind: "limit", prompt: result.limitReached };
  if (result.multiCountry) return { kind: "feature", planName: result.multiCountry.planName };
  return null;
}

// The status actions of FR-M2 AC12 for an owner or admin. Pause, Reopen and Extend run at once; Publish asks for the
// channel, Close for the reason and Mark as filled for a confirmation, each in a dialog. Every action names the version
// the page was drawn with, and revalidates the page, so the buttons follow the new status.
export function RequirementStatusActions({
  organizationId,
  slug,
  billingHref,
  target,
  status,
  startDate,
  today,
  openDays,
  extensionDays,
}: RequirementStatusActionsProps) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [refusal, setRefusal] = useState<PlanRefusal | null>(null);
  const [running, setRunning] = useState<RequirementAction | null>(null);
  const call = useActionCall("The requirement was not changed");
  const actions = requirementActions[status];

  function run(action: RequirementAction, request: () => ReturnType<typeof extendRequirement>, done: string) {
    setRunning(action);
    setRefusal(null);
    call.run(async () => {
      const result = await request();
      const planRefusal = planRefusalOf(result);
      if (!planRefusal) return result;
      setRefusal(planRefusal);
      return { silent: true };
    }, done);
  }

  const buttons: Record<RequirementAction, { label: string; onClick: () => void; variant: "primary" | "secondary" | "destructive" }> = {
    publish: {
      label: "Publish",
      variant: "primary",
      onClick: () => {
        setRefusal(null);
        setDialog("publish");
      },
    },
    reopen: {
      label: "Reopen",
      variant: "primary",
      onClick: () => run("reopen", () => changeRequirementStatus(slug, target, { to: "open" }), "The requirement is open again"),
    },
    pause: {
      label: "Pause",
      variant: "secondary",
      onClick: () => run("pause", () => changeRequirementStatus(slug, target, { to: "paused" }), "The requirement is paused"),
    },
    extend: {
      label: extendLabel(extensionDays),
      variant: "secondary",
      onClick: () => run("extend", () => extendRequirement(slug, target), "The closing date is moved"),
    },
    close: { label: "Close", variant: "secondary", onClick: () => setDialog("close") },
    fill: { label: "Mark as filled", variant: "secondary", onClick: () => setDialog("fill") },
  };

  if (actions.length === 0) return null;
  const closeDialog = () => setDialog(null);
  return (
    <section aria-labelledby="requirement-actions-heading" className="grid gap-3">
      <h2 id="requirement-actions-heading" className="text-h2">
        Status actions
      </h2>
      <div className="flex flex-wrap gap-3">
        {actions.map((action) => (
          <FormButton
            key={action}
            type="button"
            variant={buttons[action].variant}
            className="w-auto"
            busy={call.pending && running === action}
            disabled={call.pending}
            onClick={buttons[action].onClick}
          >
            {buttons[action].label}
          </FormButton>
        ))}
      </div>
      {refusal?.kind === "limit" ? (
        <Notice tone="warning" role="alert">
          <UpgradePrompt organizationId={organizationId} organizationType="employer" prompt={refusal.prompt} billingHref={billingHref} canUpgrade />
          <p className="mt-1">
            This requirement was not opened.
            {refusal.prompt.limit > 0 ? " Pause or close an open requirement to make room." : null}
          </p>
        </Notice>
      ) : null}
      {refusal?.kind === "feature" ? (
        <Notice tone="warning" role="alert">
          <p className="font-medium">{multiCountryText(refusal.planName)}</p>
          <p>
            This requirement was not opened. Edit it to keep one destination country, or{" "}
            <TextLink href={billingHref}>upgrade your plan</TextLink>.
          </p>
        </Notice>
      ) : null}
      <ModalDialog open={dialog === "publish"} onClose={closeDialog} title="Publish this requirement">
        <PublishForm
          slug={slug}
          target={target}
          closesOn={requirementClosesOn(today, startDate, openDays)}
          extensionDays={extensionDays}
          onClose={closeDialog}
          onRefused={(planRefusal) => {
            closeDialog();
            setRefusal(planRefusal);
          }}
        />
      </ModalDialog>
      <ModalDialog open={dialog === "close"} onClose={closeDialog} title="Close this requirement">
        <CloseForm slug={slug} target={target} onClose={closeDialog} />
      </ModalDialog>
      <ModalDialog open={dialog === "fill"} onClose={closeDialog} title="Mark this requirement as filled?">
        <p className="text-body leading-relaxed">
          This is final. A filled requirement cannot be reopened or changed again, and partners can no longer respond to it.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" className="w-full" onClick={closeDialog}>
            Cancel
          </FormButton>
          <FormButton
            type="button"
            variant="destructive"
            busy={call.pending && running === "fill"}
            onClick={() => {
              setRunning("fill");
              call.run(() => changeRequirementStatus(slug, target, { to: "filled" }), "The requirement is marked as filled", closeDialog);
            }}
          >
            Mark as filled
          </FormButton>
        </div>
      </ModalDialog>
    </section>
  );
}

type FormProps = { slug: string; target: RequirementTarget; onClose: () => void };

const VISIBILITY_ID = "requirement-visibility";

const visibilityOptions = [
  {
    value: "private",
    label: requirementVisibilityLabels.private,
    icon: Lock,
    description: "Only the recruitment and staffing companies you invite see it.",
  },
  {
    value: "job_order_marketplace",
    label: requirementVisibilityLabels.job_order_marketplace,
    icon: Store,
    description: "Listed partners that serve the country and the occupations see it as a job order and can respond.",
  },
] as const;

type PublishFormProps = FormProps & { closesOn: string; extensionDays: number; onRefused: (refusal: PlanRefusal) => void };

function PublishForm({ slug, target, closesOn, extensionDays, onClose, onRefused }: PublishFormProps) {
  const form = useForm<PublishFormInput>({
    resolver: zodResolver(publishFormSchema),
    defaultValues: { visibility: undefined, showIdentity: false },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const visibility = useWatch({ control, name: "visibility" });
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The requirement was not published" });

  function onSubmit(values: PublishFormInput) {
    return submit(
      () => publishRequirement(slug, target, values),
      (result) => {
        const planRefusal = planRefusalOf(result);
        if (planRefusal) onRefused(planRefusal);
        if (!result.done) return;
        onClose();
        toast({ title: "The requirement is published" });
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ visibility: VISIBILITY_ID }} />
      <RadioGroupField control={control} name="visibility" id={VISIBILITY_ID} legend="Who can see it?" options={visibilityOptions} />
      {visibility === "job_order_marketplace" ? (
        <CheckboxField
          control={control}
          name="showIdentity"
          id="requirement-show-identity"
          meta="Off: partners see your industry and the country only, until you invite or shortlist them."
        >
          Show our company name
        </CheckboxField>
      ) : null}
      <p className="text-small leading-relaxed text-muted-foreground">
        Published today, it closes on {formatDate(closesOn)} unless you extend it by {extensionDays} days at a time.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={formState.isSubmitting}>
          Publish requirement
        </FormButton>
      </div>
    </form>
  );
}

const REASON_ID = "requirement-close-reason";

const reasonOptions = [
  { value: "filled", label: "Filled", icon: CircleCheck, description: "You found the workers. This is final." },
  { value: "cancelled", label: "Cancelled", icon: Ban, description: "You no longer need the workers. This is final." },
] as const;

function CloseForm({ slug, target, onClose }: FormProps) {
  const form = useForm<CloseFormInput>({
    resolver: zodResolver(closeFormSchema),
    defaultValues: { reason: undefined },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The requirement was not closed" });

  function onSubmit(values: CloseFormInput) {
    return submit(
      () =>
        changeRequirementStatus(slug, target, values.reason === "filled" ? { to: "filled" } : { to: "closed", reason: "cancelled" }),
      (result) => {
        if (!result.done) return;
        onClose();
        toast({ title: values.reason === "filled" ? "The requirement is marked as filled" : "The requirement is closed" });
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ reason: REASON_ID }} />
      <p className="text-body leading-relaxed">
        A closed requirement cannot be reopened. Partners can no longer respond, and what they sent stays readable.
      </p>
      <RadioGroupField control={control} name="reason" id={REASON_ID} legend="Why are you closing it?" options={reasonOptions} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" variant="destructive" busy={formState.isSubmitting}>
          Close requirement
        </FormButton>
      </div>
    </form>
  );
}
