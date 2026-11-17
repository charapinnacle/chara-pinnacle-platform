"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toastError } from "@/components/feedback/toast-store";
import { controlClassName } from "@/components/forms/control-class";
import { FormButton } from "@/components/forms/form-button";
import { FormField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { Textarea } from "@/components/ui/textarea";
import { sendMessage } from "@/lib/actions/messaging";
import { formatCount } from "@/lib/i18n/format";
import { characters } from "@/lib/utils";
import { clampCharacters, messageSchema } from "@/lib/validation/messaging";

const FAILURE = "The message was not sent";

const COMPOSER_ID = "message-body";

type MessageComposerProps = {
  conversationId: string;
  recipient: string;
  maxChars: number;
  // Reads the newest messages once the database took the message, so the thread shows it at once.
  onSent: () => Promise<void>;
};

// The form under a thread (FR-P1 AC9, AC10; NFR-S10): plain text only, no attachment control, a counter that takes no
// character past the limit, Enter for a new line and Ctrl+Enter (Cmd+Enter on a Mac) or Send to send. Focus stays in the
// field after a send, so the next message can be typed at once; a failed send keeps the text.
export function MessageComposer({ conversationId, recipient, maxChars, onSent }: MessageComposerProps) {
  const router = useRouter();
  const [fileDropped, setFileDropped] = useState(false);
  const form = useForm({ resolver: zodResolver(messageSchema(maxChars)), defaultValues: { body: "" } });
  const { control, formState, handleSubmit, reset, setFocus } = form;
  const { submit } = useServerFormSubmit(form, { failureTitle: FAILURE });
  const length = characters(useWatch({ control, name: "body" }));

  const send = handleSubmit((values) =>
    submit(
      () => sendMessage(conversationId, values),
      (result) => {
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
