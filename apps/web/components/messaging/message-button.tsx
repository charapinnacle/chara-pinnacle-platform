"use client";

import { MessageSquare } from "lucide-react";
import { usePathname } from "next/navigation";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { openConversation, type OpenConversationResult } from "@/lib/actions/messaging";
import type { PageContext } from "@/lib/validation/messaging";

type MessageButtonProps = {
  contextType: PageContext;
  contextId: string;
  // The organisation of the page, or null on a candidate's page.
  slug: string | null;
  // Whom the conversation is with, for the accessible name: "Message Amina Okafor".
  recipient: string;
};

// The "Message" action of a context page (FR-P1 AC1, SOP P2-26 step Open): opens the conversation of the context, or the
// one already open, and goes to it.
export function MessageButton({ contextType, contextId, slug, recipient }: MessageButtonProps) {
  const pathname = usePathname();
  const { pending, run } = useActionCall("The conversation could not be opened");

  function open() {
    run(async () => {
      const result: OpenConversationResult | undefined = await openConversation({ contextType, contextId, slug }, pathname);
      return result?.message ? result : { silent: true };
    }, "");
  }

  return (
    <FormButton type="button" variant="secondary" className="w-full sm:w-auto" busy={pending} onClick={open}>
      <MessageSquare aria-hidden className="size-4" />
      Message<span className="sr-only"> {recipient}</span>
    </FormButton>
  );
}
