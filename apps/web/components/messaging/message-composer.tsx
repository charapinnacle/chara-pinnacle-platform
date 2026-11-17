"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { toastError } from "@/components/feedback/toast-store";
import { controlClassName } from "@/components/forms/control-class";
import { FormButton } from "@/components/forms/form-button";
import { FormField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { Textarea } from "@/components/ui/textarea";
import { sendMessage } from "@/lib/actions/messaging";
import type { OrganizationType, UsagePrompt } from "@/lib/billing/limits";
import { formatCount } from "@/lib/i18n/format";
import { characters } from "@/lib/utils";
import { clampCharacters, messageSchema } from "@/lib/validation/messaging";

const FAILURE = "The message was not sent";

const COMPOSER_ID = "message-body";

// The organisation the member sends for, whose monthly limit can stop a message (FR-P3 AC4); none for the candidate, who
// is never limited.
export type ComposerOrganization = { id: string; type: OrganizationType; canUpgrade: boolean; billingHref: string };

type MessageComposerProps = {
  conversationId: string;
  recipient: string;
  maxChars: number;
  organization: ComposerOrganization | null;
  // Reads the newest messages once the database took the message, so the thread shows it at once.
  onSent: () => Promise<void>;
};

// The form under a thread (FR-P1 AC9, AC10; NFR-S10): plain text only, no attachment control, a counter that takes no
// character past the limit, Enter for a new line and Ctrl+Enter (Cmd+Enter on a Mac) or Send to send. Focus stays in the
// field after a send, so the next message can be typed at once; a failed send keeps the text. At the organisation's monthly
// limit the text stays and the upgrade prompt says the usage and the plan, with the way to upgrade for an owner or admin.
export function MessageComposer({ conversationId, recipient, maxChars, organization, onSent }: MessageComposerProps) {
  const router = useRouter();
  const [fileDropped, setFileDropped] = useState(false);
  const [limitReached, setLimitReached] = useState<UsagePrompt | null>(null);
  const form = useForm({ resolver: zodResolver(messageSchema(maxChars)), defaultValues: { body: "" } });
  const { control, formState, handleSubmit, reset, setFocus } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE });
  const length = characters(useWatch({ control, name: "body" }));

  const send = handleSubmit((values) =>
    submit(
      () => sendMessage(conversationId, values, organization?.type),
      (result) => {
        setLimitReached(result.limitReached ?? null);
        if (result.done) {
          reset({ body: "" });
          setFileDropped(false);
          setFocus("body");
          void onSent();
          return;
        }
        if (result.message) toastError(FAILURE, result.message);
        if (result.closed) router.refresh();
      },
    ),
  );

  return (
    <form
      noValidate
      aria-label="Write a message"
      className="grid gap-3"
      onSubmit={send}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        setFileDropped(true);
      }}
    >
      <FormField
        control={control}
        name="body"
        id={COMPOSER_ID}
        label={`Message to ${recipient}`}
        description={`${formatCount(length)} / ${formatCount(maxChars)} characters. Enter starts a new line; Ctrl+Enter sends.`}
      >
        {({ onChange, ...field }) => (
          <Textarea
            {...field}
            rows={4}
            className={controlClassName}
            onChange={(event) => onChange(clampCharacters(event.target.value, maxChars))}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
              event.preventDefault();
              void send();
            }}
          />
        )}
      </FormField>
      <div role="status" aria-live="polite">
        {limitReached && organization ? (
          <Notice tone="warning">
            <div className="grid gap-1">
              <UpgradePrompt
                organizationId={organization.id}
                organizationType={organization.type}
                prompt={limitReached}
                billingHref={organization.billingHref}
                canUpgrade={organization.canUpgrade}
              />
              {organization.canUpgrade ? null : <p className="text-small">Ask an owner or administrator to upgrade.</p>}
            </div>
          </Notice>
        ) : null}
      </div>
      {fileDropped ? (
        <Notice tone="info" role="status">
          Files cannot be sent in messages. Documents are shared through the passport.
        </Notice>
      ) : null}
      <div>
        <FormButton type="submit" busy={formState.isSubmitting} className="w-full sm:w-auto">
          Send
        </FormButton>
      </div>
    </form>
  );
}
