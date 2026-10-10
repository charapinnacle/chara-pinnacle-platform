"use client";

import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback/toast-store";
import { CodeForm } from "@/components/mfa/code-form";
import { verifyEnrolment } from "@/lib/actions/mfa";
import type { Enrolment } from "@/lib/dal/mfa";

type EnrolmentFormProps = { enrolment: Enrolment; next?: string };

export function EnrolmentForm({ enrolment, next }: EnrolmentFormProps) {
  const router = useRouter();
  return (
    <div className="grid gap-6">
      {/* A plain img: next/image writes a style attribute, which the CSP blocks (style-src-attr), and a data URL has
          nothing to optimise. */}
      <picture className="mx-auto">
        <img
          src={enrolment.qrCode}
          alt="QR code to add CHARA to your authenticator app. If you cannot scan it, use the setup key below."
          width={200}
          height={200}
          className="block rounded-lg border bg-white p-2"
        />
      </picture>
      <div className="grid gap-1.5 text-body">
        <p className="text-muted-foreground">Setup key, if you cannot scan the code</p>
        <code className="rounded-lg border bg-muted px-3 py-2 font-mono text-small break-all select-all">
          {enrolment.secret}
        </code>
      </div>
      <CodeForm
        id={`mfa-code-${enrolment.factorId}`}
        description="Enter the 6-digit code that your authenticator app shows for CHARA."
        submitLabel="Verify and continue"
        busyLabel="Verifying..."
        failureTitle="Could not verify the code"
        devices={[{ id: enrolment.factorId, name: "" }]}
        onSubmit={(values) => verifyEnrolment({ ...values, next })}
        onResult={(result) => {
          if (!result.added) return;
          toast({ title: "Backup device added" });
          router.refresh();
        }}
      />
    </div>
  );
}
