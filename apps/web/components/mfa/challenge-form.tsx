"use client";

import { CodeForm } from "@/components/mfa/code-form";
import { answerChallenge } from "@/lib/actions/mfa";

type ChallengeFormProps = { devices: readonly { id: string; name: string }[]; next?: string };

export function ChallengeForm({ devices, next }: ChallengeFormProps) {
  return (
    <CodeForm
      id="mfa-code"
      description="Open your authenticator app and enter the 6-digit code it shows for CHARA."
      submitLabel="Verify and continue"
      busyLabel="Verifying..."
      failureTitle="Could not verify the code"
      devices={devices}
      onSubmit={(values) => answerChallenge({ ...values, next })}
    />
  );
}
