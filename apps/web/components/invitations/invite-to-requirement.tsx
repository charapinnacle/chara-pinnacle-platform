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
import type { InviteEmployer } from "@/lib/dal/invitations";
import { employerStatusLabels, invitationUsageText, inviteSentText, type InvitationStatus } from "@/lib/invitations/presentation";
import { billingPath } from "@/lib/routes";
import { inviteToRequirementSchema, type InviteToRequirementInput } from "@/lib/validation/invitation";

const REQUIREMENT_ID = "invite-requirement";

type InviteToRequirementProps = {
  lang: string;
  partner: { id: string; name: string };
  // Every employer the viewer manages with its open requirements, the preferred one first.
  employers: InviteEmployer[];
  // The requirements this partner already has an invitation to, with the status.
  invited: Record<string, InvitationStatus>;
  source: "profile" | "saved";
};

// The value of a radio names the employer and the requirement: "<employer slug>/<requirement id>".
function choiceValue(employer: InviteEmployer, requirementId: string): string {
  return `${employer.slug}/${requirementId}`;
}

// Invite one partner to an open requirement from its profile or the saved partners (FR-O1 step Select, AC12): the
// button is named "Invite <partner name>", and the dialog offers the open requirements of every employer the viewer
// manages, grouped by employer, each with its allowance used. A requirement the partner already has an invitation to is
// listed with the real status instead of being offered. The invitation, the upgrade prompt and its billing page follow
// the employer of the chosen requirement; at the plan's limit nothing is written.
export function InviteToRequirement({ lang, partner, employers, invited, source }: InviteToRequirementProps) {
  const [open, setOpen] = useState(false);
  // The confirmation stays next to the button after the dialog closed, besides the toast (NFR-U4).
  const [sent, setSent] = useState("");
  const close = () => setOpen(false);
  const offered = employers
    .map((employer) => ({ ...employer, requirements: employer.requirements.filter(({ id }) => !invited[id]) }))
    .filter((employer) => employer.requirements.length > 0);
  const already = employers.flatMap((employer) =>
    employer.requirements.filter(({ id }) => invited[id]).map((requirement) => ({ employer, requirement })),
  );
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-auto gap-2" onClick={() => setOpen(true)}>
        <Send aria-hidden className="size-4" />
        Invite<span className="sr-only"> {partner.name}</span>
      </FormButton>
      <p role="status" className="text-small text-muted-foreground empty:hidden">
        {sent}
      </p>
      <ModalDialog open={open} onClose={close} title={`Invite ${partner.name} to a requirement`}>
        {already.length > 0 ? (
          <ul aria-label="Requirements this partner is invited to" className="grid gap-1 text-small text-muted-foreground">
            {already.map(({ employer, requirement }) => (
              <li key={requirement.id} className="break-words">
                {employers.length > 1 ? `${employer.name}: ` : null}
                {requirement.title}: {employerStatusLabels[invited[requirement.id]]}
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
          <InviteForm lang={lang} partner={partner} employers={offered} source={source} onClose={close} onSent={setSent} />
        )}
      </ModalDialog>
    </>
  );
}

type InviteFormProps = Omit<InviteToRequirementProps, "invited"> & { onClose: () => void; onSent: (confirmation: string) => void };

function InviteForm({ lang, partner, employers, source, onClose, onSent }: InviteFormProps) {
  const [first] = employers;
  const form = useForm<InviteToRequirementInput>({
    resolver: zodResolver(inviteToRequirementSchema),
    // The preferred employer comes first; its only requirement is chosen for the person.
    defaultValues: { requirement: first.requirements.length === 1 ? choiceValue(first, first.requirements[0].id) : "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The partner was not invited" });
  const [limit, setLimit] = useState<{ prompt: UsagePrompt; employer: InviteEmployer; requirementId: string } | null>(null);

  function onSubmit(values: InviteToRequirementInput) {
    const [slug, requirementId] = values.requirement.split("/");
    const employer = employers.find((item) => item.slug === slug);
    if (!employer || !requirementId) return;
    setLimit(null);
    return submit(
      () => invitePartners(employer.slug, { requirementId, partnerIds: [partner.id], source }),
      (result) => {
        if (result.limitReached) {
          setLimit({ prompt: result.limitReached, employer, requirementId });
          return;
        }
        const [outcome] = result.outcomes ?? [];
        if (!outcome) return;
        onClose();
        if (outcome.alreadyInvited) {
          toastError(`${partner.name} already has an invitation to this requirement`, `Status: ${employerStatusLabels[outcome.status]}.`);
          return;
        }
        const title = employer.requirements.find(({ id }) => id === requirementId)?.title;
        const confirmation = inviteSentText(partner.name, employer.name, title);
        onSent(confirmation);
        toast({
          title: `Invitation sent to ${partner.name}`,
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
            organizationId={limit.employer.organizationId}
            organizationType="employer"
            prompt={limit.prompt}
            billingHref={billingPath(lang, limit.employer.slug)}
            canUpgrade
            requirement={{ id: limit.requirementId, attempted: 1 }}
          />
          <p className="mt-1">{partner.name} was not invited.</p>
        </Notice>
      ) : null}
      <p className="text-small leading-normal text-muted-foreground">
        {partner.name} sees the requirement and the name of the employer that invites, and can accept or decline.
      </p>
      {employers.map((employer, index) => (
        <RadioGroupField
          key={employer.slug}
          control={control}
          name="requirement"
          id={index === 0 ? REQUIREMENT_ID : `${REQUIREMENT_ID}-${employer.slug}`}
          legend={`Open requirements of ${employer.name}`}
          options={employer.requirements.map(({ id, title, used }) => ({
            value: choiceValue(employer, id),
            label: title,
            icon: ClipboardList,
            description: invitationUsageText({ used, limit: employer.limit, applies: employer.applies, planName: employer.planName }),
          }))}
        />
      ))}
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
