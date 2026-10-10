"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { SelectField } from "@/components/forms/select-field";
import { TextLink } from "@/components/forms/text-link";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { InvitationLink } from "@/components/team/invitation-link";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { inviteMember, type InviteResult } from "@/lib/actions/team";
import {
  invitableRoles,
  inviteFormSchema,
  memberLimitMessage,
  type InviteFormInput,
  type InviteFormOutput,
} from "@/lib/validation/team";

type InviteDialogProps = {
  slug: string;
  billingHref: string;
  allowance: { limit: number | null; used: number };
};

type Created = NonNullable<InviteResult["invitation"]> & { email: string; role: InviteFormOutput["role"] };

const ids = { email: "invite-email", role: "invite-role" } as const;

export function InviteDialog({ slug, billingHref, allowance }: InviteDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [refusedLimit, setRefusedLimit] = useState<{ limit: number | null } | null>(null);
  const limit = refusedLimit ? refusedLimit.limit : allowance.limit;
  const atLimit = refusedLimit !== null || (limit !== null && allowance.used >= limit);

  function close() {
    setOpen(false);
    setCreated(null);
    setRefusedLimit(null);
    if (created) router.refresh();
  }

  return (
    <>
      <FormButton type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        Invite member
      </FormButton>
      <ModalDialog open={open} onClose={close} title={created ? "Invitation link" : "Invite a team member"}>
        {created ? (
          <InvitationLink {...created} onDone={close} />
        ) : (
          <InviteForm
            slug={slug}
            billingHref={billingHref}
            limitMessage={atLimit ? memberLimitMessage(limit) : null}
            onCreated={setCreated}
            onLimitReached={setRefusedLimit}
            onClose={close}
          />
        )}
      </ModalDialog>
    </>
  );
}

type InviteFormProps = {
  slug: string;
  billingHref: string;
  limitMessage: string | null;
  onCreated: (created: Created) => void;
  onLimitReached: (refused: { limit: number | null }) => void;
  onClose: () => void;
};

function InviteForm({ slug, billingHref, limitMessage, onCreated, onLimitReached, onClose }: InviteFormProps) {
  const form = useForm<InviteFormInput, undefined, InviteFormOutput>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { email: "", role: "member" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "Could not create the invitation" });

  const items: ErrorSummaryItem[] = (Object.keys(ids) as (keyof typeof ids)[]).flatMap((name) => {
    const error = formState.errors[name];
    return error ? [{ key: name, message: String(error.message), targetId: ids[name] }] : [];
  });

  // A toast sits outside the modal, so the dialog closes before it is shown.
  function onSubmit(values: InviteFormOutput) {
    return submit(
      () => inviteMember({ ...values, slug }),
      (result) => {
        if (result.invitation) onCreated({ ...result.invitation, email: values.email, role: values.role });
        if (result.limitReached) onLimitReached(result.limitReached);
        if (result.message) {
          onClose();
          toast({ variant: "error", title: "Could not create the invitation", description: result.message });
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-5" onSubmit={handleSubmit(onSubmit)}>
      <ErrorSummary
        ref={summaryRef}
        items={items}
        onSelect={(key) => form.setFocus(key as FieldPath<InviteFormInput>)}
      />
      {limitMessage ? (
        <Notice tone="info" role="status">
          {limitMessage}{" "}
          <TextLink href={billingHref} className="whitespace-nowrap">
            View plans
          </TextLink>
        </Notice>
      ) : null}
      <InputField control={control} name="email" id={ids.email} label="Email address" type="email" autoComplete="off" />
      <SelectField
        control={control}
        name="role"
        id={ids.role}
        label="Role"
        placeholder="Choose a role"
        options={invitableRoles}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" className="w-full" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={formState.isSubmitting} disabled={limitMessage !== null}>
          {formState.isSubmitting ? "Creating invitation..." : "Create invitation"}
        </FormButton>
      </div>
    </form>
  );
}
