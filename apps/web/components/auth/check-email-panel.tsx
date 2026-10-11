"use client";

import { useEffect, useRef, useState } from "react";
import { toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { isRedirectError } from "@/lib/redirect-error";
import type { ResendAnswer } from "@/lib/pending-email";

type CheckEmailPanelProps = {
  maskedEmail: string;
  initialCooldown: number;
  resend: () => Promise<ResendAnswer>;
  differentAddressHref: string;
};

type Outcome = { tone: "info" | "error"; text: string } | null;

// The seconds until the next email may be asked for. The end is kept as a time, not counted down, so that a background tab
// that was paused is right again when it wakes.
function useCooldown(initial: number) {
  const end = useRef(0);
  const [remaining, setRemaining] = useState(initial);
  useEffect(() => {
    end.current = Date.now() + initial * 1000;
    const timer = setInterval(() => setRemaining(Math.max(0, Math.ceil((end.current - Date.now()) / 1000))), 250);
    return () => clearInterval(timer);
  }, [initial]);
  function restart(seconds: number) {
    end.current = Date.now() + seconds * 1000;
    setRemaining(seconds);
  }
  return { remaining, restart };
}

// What the page after sign-up and after a password reset request shows under its text: where the link went (masked), a Resend
// button that needs no address and shows its cooldown, and a way back to the form. The button stays focusable while it waits
// (aria-disabled), so the cooldown can be read from the keyboard; the result is announced in a polite live region.
export function CheckEmailPanel({ maskedEmail, initialCooldown, resend, differentAddressHref }: CheckEmailPanelProps) {
  const { remaining, restart } = useCooldown(initialCooldown);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const waiting = remaining > 0;

  async function onResend() {
    if (waiting || sending) return;
    setSending(true);
    setOutcome(null);
    try {
      const result = await resend();
      restart(result.cooldown);
      if (result.message) setOutcome({ tone: "error", text: result.message });
      else if (result.sent) setOutcome({ tone: "info", text: "We sent the email again." });
    } catch (error) {
      if (isRedirectError(error)) return;
      setOutcome({ tone: "error", text: GENERIC_FAILURE });
      toastNetworkError("Could not send the email");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-5">
      <p className="text-center text-body text-muted-foreground">
        Sent to <span className="font-medium whitespace-nowrap text-foreground">{maskedEmail}</span>
      </p>
      <div role="status" aria-live="polite" className="sr-only">
        {outcome?.text}
      </div>
      {outcome ? (
        <Notice tone={outcome.tone} aria-hidden>
          {outcome.text}
        </Notice>
      ) : null}
      <FormButton
        type="button"
        busy={sending}
        aria-disabled={waiting || undefined}
        onClick={onResend}
        className={waiting ? "cursor-not-allowed opacity-60 hover:bg-primary hover:shadow-xs active:bg-primary" : undefined}
      >
        {sending ? "Sending..." : waiting ? `Resend in ${remaining} s` : "Resend email"}
      </FormButton>
      <p className="text-center text-small text-muted-foreground">Not there? Check your spam or promotions folder.</p>
      <TextLink standalone="center" href={differentAddressHref}>
        Use a different address
      </TextLink>
    </div>
  );
}
