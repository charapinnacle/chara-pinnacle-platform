"use client";

import { useState, useTransition } from "react";
import { toastError, toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { openReportedMessage } from "@/lib/actions/admin-reports";
import type { ReportedMessage } from "@/lib/dal/admin-reports";
import { formatDateTime } from "@/lib/i18n/format";
import { isRedirectError } from "@/lib/redirect-error";
import { cn } from "@/lib/utils";

const FAILURE = "The message could not be opened";

function senderOf({ senderKind, senderName, senderOrganizationName }: ReportedMessage): string {
  if (senderKind === "worker") return "Candidate";
  const organization = senderOrganizationName ?? "Organisation";
  return senderName ? `${senderName}, ${organization}` : `Former member, ${organization}`;
}

// The reported message and the five messages before and after it (FR-P3 AC7, NFR-C5), opened only when the handler asks:
// every opening is recorded, so nothing is read with the page. The candidate is named "Candidate", as everywhere staff read.
export function ReportedMessageContext({ reportId }: { reportId: number }) {
  const [messages, setMessages] = useState<ReportedMessage[] | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    startTransition(async () => {
      try {
        const result = await openReportedMessage(reportId);
        if (result.messages) setMessages(result.messages);
        else toastError(FAILURE, result.message);
      } catch (error) {
        if (!isRedirectError(error)) toastNetworkError(FAILURE);
      }
    });
  }

  if (!messages) {
    return (
      <div className="grid gap-3">
        <p className="text-body text-muted-foreground">
          Only the Trust &amp; Safety Administrator who put this report in review can read the message and the ten around it.
          Every opening is recorded.
        </p>
        <div>
          <FormButton type="button" variant="secondary" className="w-full sm:w-auto" busy={pending} onClick={open}>
            Show the reported message
          </FormButton>
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="reported-message-heading" className="grid gap-3">
      <h3 id="reported-message-heading" className="text-h3">
        The reported message in its conversation
      </h3>
      <ol className="grid gap-3">
        {messages.map((message) => (
          <li
            key={message.id}
            className={cn("grid gap-1 rounded-xl border p-card-sm", message.reported ? "border-foreground/40 bg-accent/40" : "bg-card")}
          >
            <p className="flex flex-wrap gap-x-2 text-small text-muted-foreground">
              <span className="font-medium text-foreground wrap-anywhere">{senderOf(message)}</span>
              <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
              {message.reported ? <strong className="text-foreground">Reported message</strong> : null}
            </p>
            <p className="text-body whitespace-pre-wrap wrap-anywhere">{message.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
