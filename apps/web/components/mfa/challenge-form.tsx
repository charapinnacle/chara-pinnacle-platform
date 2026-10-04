"use client";

import { CodeForm } from "@/components/mfa/code-form";
import { answerChallenge } from "@/lib/actions/mfa";

export function ChallengeForm({ next, hasBackup }: { next?: string; hasBackup: boolean }) {
  return (
    <CodeForm
      id="mfa-code"
      description={
        hasBackup
          ? "Enter the 6-digit code from either of your authenticator apps."
          : "Open your authenticator app and enter the 6-digit code it shows for CHARA."
      }
      submitLabel="Verify and continue"
      busyLabel="Verifying..."
      failureTitle="Could not verify the code"
      onSubmit={(code) => answerChallenge({ code, next })}
    />
  );
}
