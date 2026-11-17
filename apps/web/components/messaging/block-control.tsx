"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { setConversationBlocked } from "@/lib/actions/messaging";

type BlockControlProps = {
  conversationId: string;
  counterpart: string;
  // Whether the caller blocked the conversation and may lift the block; a block of someone else offers nothing.
  blockedByMe: boolean;
};

// Block a conversation for both sides, or unblock one the caller blocked (FR-P3 AC8, SOP P2-28 step Block). A block is
// confirmed first, as it stops the caller's own messages too; the other side reads that the conversation is closed, not
// who closed it.
export function BlockControl({ conversationId, counterpart, blockedByMe }: BlockControlProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [confirming, setConfirming] = useState(false);
  const block = useActionCall("The conversation was not blocked");
  const unblock = useActionCall("The conversation was not unblocked");

  if (blockedByMe) {
    return (
      <div>
        <FormButton
          type="button"
          variant="secondary"
          className="w-full sm:w-auto"
          busy={unblock.pending}
          onClick={() =>
            unblock.run(async () => {
              const result = await setConversationBlocked(conversationId, false, pathname);
              if (result.done) router.refresh();
              return result;
            }, "Conversation unblocked")
          }
        >
          Unblock conversation
        </FormButton>
      </div>
    );
  }

  return (
    <div>
      <FormButton type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setConfirming(true)}>
        Block conversation
      </FormButton>
      <ModalDialog open={confirming} onClose={() => setConfirming(false)} title="Block this conversation?">
        <p className="text-body">
          Neither you nor {counterpart} can send messages here until you unblock it. The history stays readable for both sides,
          and {counterpart} is not told who blocked it. To report a message, use Report next to it.
        </p>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <FormButton type="button" variant="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </FormButton>
          <FormButton
            type="button"
            busy={block.pending}
            onClick={() =>
              block.run(
                async () => {
                  const result = await setConversationBlocked(conversationId, true, pathname);
                  if (result.done) router.refresh();
                  return result;
                },
                "Conversation blocked",
                () => setConfirming(false),
              )
            }
          >
            Block conversation
          </FormButton>
        </div>
      </ModalDialog>
    </div>
  );
}
