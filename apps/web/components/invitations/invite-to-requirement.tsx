"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ClipboardList, Send } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast, toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { Notice } from "@/components/forms/notice";
import { RadioGroupField } from "@/components/forms/radio-group-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { invitePartners } from "@/lib/actions/invitations";
import type { UsagePrompt } from "@/lib/billing/limits";
import { employerStatusLabels, invitationUsageText, type InvitationStatus } from "@/lib/invitations/presentation";
import { inviteToRequirementSchema, type InviteToRequirementInput } from "@/lib/validation/invitation";

const REQUIREMENT_ID = "invite-requirement";

type InviteToRequirementProps = {
  // The employer that invites, by its address and id.
  slug: string;
  organizationId: string;
  partner: { id: string; name: string };
  // Its open requirements, newest first, and the ones this partner already has an invitation to, with the status.
  requirements: { id: string; title: string }[];
  invited: Record<string, InvitationStatus>;
  billingHref: string;
  source: "profile" | "directory";
};

// Invite one partner to an open requirement from its profile or the saved partners (FR-O1 step Select, AC12): the
// button is named "Invite <partner name>", and the dialog asks which requirement. A requirement the partner already has
// an invitation to is listed with the real status instead of being offered. At the plan's limit the dialog shows the
// upgrade prompt with the plan and the billing page, and nothing is written.
export function InviteToRequirement({ slug, organizationId, partner, requirements, invited, billingHref, source }: InviteToRequirementProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const offered = requirements.filter(({ id }) => !invited[id]);
  const already = requirements.filter(({ id }) => invited[id]);
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-auto gap-2" onClick={() => setOpen(true)}>
        <Send aria-hidden className="size-4" />
        Invite<span className="sr-only"> {partner.name}</span>
      </FormButton>
      <ModalDialog open={open} onClose={close} title={`Invite ${partner.name} to a requirement`}>
        {already.length > 0 ? (
          <ul aria-label="Requirements this partner is invited to" className="grid gap-1 text-small text-muted-foreground">
            {already.map(({ id, title }) => (
              <li key={id} className="break-words">
                {title}: {employerStatusLabels[invited[id]]}
              </li>
            ))}
          </ul>
        ) : null}
        {offered.length === 0 ? (
          <>
            <p className="text-body leading-relaxed">{partner.name} already has an invitation to each of your open requirements.</p>
            <FormButton type="button" variant="secondary" onClick={close}>
              Close
            </FormButton>
          </>
        ) : (
          <InviteForm
            slug={slug}
            organizationId={organizationId}
            partner={partner}
            requirements={offered}
            billingHref={billingHref}
            source={source}
            onClose={close}
          />
        )}
      </ModalDialog>
    </>
  );
}

type InviteFormProps = Omit<InviteToRequirementProps, "invited"> & { onClose: () => void };

function InviteForm({ slug, organizationId, partner, requirements, billingHref, source, onClose }: InviteFormProps) {
  const form = useForm<InviteToRequirementInput>({
    resolver: zodResolver(inviteToRequirementSchema),
    defaultValues: { requirement: requirements.length === 1 ? requirements[0].id : "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The partner was not invited" });
  const [limit, setLimit] = useState<{ prompt: UsagePrompt; requirementId: string } | null>(null);

  function onSubmit(values: InviteToRequirementInput) {
    setLimit(null);
    return submit(
      () => invitePartners(slug, { requirementId: values.requirement, partnerIds: [partner.id], source }),
      (result) => {
        if (result.limitReached) {
          setLimit({ prompt: result.limitReached, requirementId: values.requirement });
          return;
        }
        const [outcome] = result.outcomes ?? [];
        if (!outcome) return;
        onClose();
        if (outcome.alreadyInvited) {
          toastError(`${partner.name} already has an invitation to this requirement`, `Status: ${employerStatusLabels[outcome.status]}.`);
          return;
        }
        toast({
          title: `${partner.name} is invited`,
          description: result.usage ? `${invitationUsageText(result.usage)}.` : undefined,
        });
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ requirement: REQUIREMENT_ID }} />
      {limit ? (
        <Notice tone="warning" role="alert">
          <UpgradePrompt
            organizationId={organizationId}
            organizationType="employer"
            prompt={limit.prompt}
            billingHref={billingHref}
            canUpgrade
            requirementId={limit.requirementId}
          />
          <p className="mt-1">{partner.name} was not invited.</p>
        </Notice>
      ) : null}
      <RadioGroupField
        control={control}
        name="requirement"
        id={REQUIREMENT_ID}
        legend="Which open requirement?"
        description={`${partner.name} sees the requirement and your company name, and can accept or decline.`}
        options={requirements.map(({ id, title }) => ({ value: id, label: title, icon: ClipboardList }))}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={formState.isSubmitting}>
          Send invitation
        </FormButton>
      </div>
    </form>
  );
}
