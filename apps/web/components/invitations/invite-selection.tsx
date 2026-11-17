"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { FormProvider, useController, useForm, useFormContext, useWatch } from "react-hook-form";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { toastError, toastNetworkError } from "@/components/feedback/toast-store";
import { Checkbox } from "@/components/forms/checkbox-field";
import { FieldMessage } from "@/components/forms/field-message";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import { invitePartners, type InviteResult } from "@/lib/actions/invitations";
import type { UsagePrompt } from "@/lib/billing/limits";
import { inviteConfirmation, invitationUsageText, selectedText, type InvitationUsage } from "@/lib/invitations/presentation";
import { isRedirectError } from "@/lib/redirect-error";
import { inviteSelectionSchema, type InviteSelectionInput } from "@/lib/validation/invitation";

const FAILURE = "Nobody was invited";
const ERROR_ID = "invite-selection-error";

type Outcome =
  | { kind: "sent"; sent: string | null; already: string[]; usage: InvitationUsage | null }
  | { kind: "limit"; prompt: UsagePrompt; attempted: number };

type InviteSelectionProps = {
  organizationId: string;
  slug: string;
  requirementId: string;
  billingHref: string;
  // The allowance of the requirement when the page was drawn, for "1 of 3 invitations used" next to the button.
  usage: InvitationUsage;
  // The names of the partners on the page, for the confirmation.
  names: Record<string, string>;
  children: React.ReactNode;
};

// Select partners on the suggestions page and invite them in one go (FR-M3 step Act, AC7; FR-O1 AC12): each card has a
// checkbox labelled with the partner's name, and Invite selected shows the number selected and the plan's allowance for
// the requirement. Up to 25 at a time; the database checks the rest (the limit refuses the call as a whole, which shows
// the upgrade prompt; a partner that already had an invitation is named with its real status).
export function InviteSelection({ organizationId, slug, requirementId, billingHref, usage, names, children }: InviteSelectionProps) {
  const form = useForm<InviteSelectionInput>({
    resolver: zodResolver(inviteSelectionSchema),
    defaultValues: { partners: [] },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, reset } = form;
  const selected = useWatch({ control, name: "partners" });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const shownUsage = outcome?.kind === "sent" && outcome.usage ? outcome.usage : usage;

  async function onSubmit(values: InviteSelectionInput) {
    setOutcome(null);
    let result: InviteResult;
    try {
      result = await invitePartners(slug, { requirementId, partnerIds: values.partners, source: "suggestions" });
    } catch (error) {
      if (!isRedirectError(error)) toastNetworkError(FAILURE);
      return;
    }
    if (result.limitReached) {
      setOutcome({ kind: "limit", prompt: result.limitReached, attempted: values.partners.length });
      return;
    }
    if (result.message || !result.outcomes) {
      toastError(FAILURE, result.message);
      return;
    }
    const confirmation = inviteConfirmation(
      result.outcomes.map((item) => ({ ...item, name: names[item.partnerId] ?? "A partner" })),
    );
    setOutcome({ kind: "sent", ...confirmation, usage: result.usage ?? null });
    reset({ partners: [] });
  }

  return (
    <FormProvider {...form}>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card p-card-sm">
          <FormButton
            type="button"
            className="w-auto"
            busy={formState.isSubmitting}
            onClick={handleSubmit(onSubmit)}
            aria-describedby={formState.errors.partners ? ERROR_ID : undefined}
          >
            Invite selected ({selected.length})
          </FormButton>
          <p className="text-small text-muted-foreground">
            {selectedText(selected.length)} · {invitationUsageText(shownUsage)}
          </p>
          <FieldMessage id={ERROR_ID} error={formState.errors.partners} />
        </div>
        {outcome?.kind === "sent" ? (
          <Notice tone="info" role="status">
            {outcome.sent ? <p className="font-medium">{outcome.sent}</p> : null}
            {outcome.already.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {outcome.usage ? <p>{invitationUsageText(outcome.usage)}.</p> : null}
          </Notice>
        ) : null}
        {outcome?.kind === "limit" ? (
          <Notice tone="warning" role="alert">
            <UpgradePrompt
              organizationId={organizationId}
              organizationType="employer"
              prompt={outcome.prompt}
              billingHref={billingHref}
              canUpgrade
              requirement={{ id: requirementId, attempted: outcome.attempted }}
            />
            <p className="mt-1">Nobody was invited. Select fewer partners, or withdraw an invitation before a response to make room.</p>
          </Notice>
        ) : null}
        {children}
      </div>
    </FormProvider>
  );
}

// The checkbox of one suggestion card, labelled "Invite <partner name>" in full, so each box of the list has its own name in
// every assistive technology (FR-M3 AC7, FR-O1 AC12).
export function InviteCheckbox({ partnerId, name }: { partnerId: string; name: string }) {
  const { control } = useFormContext<InviteSelectionInput>();
  const { field } = useController({ control, name: "partners" });
  const id = `invite-${partnerId}`;
  const checked = field.value.includes(partnerId);
  return (
    <div className="flex min-h-11 items-center gap-3">
      <Checkbox
        id={id}
        checked={checked}
        onBlur={field.onBlur}
        onChange={(event) =>
          field.onChange(event.target.checked ? [...field.value, partnerId] : field.value.filter((value) => value !== partnerId))
        }
      />
      <label htmlFor={id} className="cursor-pointer text-body wrap-anywhere">
        Invite {name}
      </label>
    </div>
  );
}
