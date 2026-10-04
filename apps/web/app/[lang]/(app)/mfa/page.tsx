import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { BackupFactorForm } from "@/components/mfa/backup-factor-form";
import { ChallengeForm } from "@/components/mfa/challenge-form";
import { EnrolmentForm } from "@/components/mfa/enrolment-form";
import { listVerifiedFactors, startEnrolment } from "@/lib/dal/mfa";
import { requireUser } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { homePath } from "@/lib/routes";
import { mfaReturnPath } from "@/lib/safe-next";
import { FIRST_FACTOR_NAME, MAX_TOTP_FACTORS, TOO_MANY_FACTORS } from "@/lib/validation/mfa";

export const metadata: Metadata = { title: "Two-step verification — CHARA", robots: { index: false } };

export default async function MfaPage({ params, searchParams }: PageProps<"/[lang]/mfa">) {
  const { lang } = await params;
  const { next } = await searchParams;
  const user = await requireUser(lang);
  const nextPath = typeof next === "string" ? next : undefined;
  const home = homePath(lang, user.accountKind);
  const factors = await listVerifiedFactors(lang);

  if (factors.length === 0) {
    const started = await startEnrolment(lang, FIRST_FACTOR_NAME);
    if ("refused" in started) throw new Error("Two-step verification could not be started");
    return (
      <AuthCard
        icon={ShieldCheck}
        title="Set up two-step verification"
        description="Scan the QR code with an authenticator app such as Google Authenticator, 1Password or Authy, then enter the code it shows."
      >
        <EnrolmentForm enrolment={started} next={nextPath} />
      </AuthCard>
    );
  }

  if (user.aal !== "aal2") {
    return (
      <AuthCard
        icon={ShieldCheck}
        title="Verify it is you"
        description="Enter a code from your authenticator app to continue."
        footer="Lost your device? Use your backup device if you added one. Otherwise contact CHARA support: a platform administrator resets your two-step verification after checking your identity, and you then set it up again."
      >
        <ChallengeForm next={nextPath} hasBackup={factors.length > 1} />
      </AuthCard>
    );
  }

  const requested = mfaReturnPath(lang, nextPath, "");
  if (requested) redirect(requested);

  return (
    <AuthCard
      icon={ShieldCheck}
      title="Two-step verification is on"
      description="Your account asks for a code from an authenticator app each time you log in."
    >
      <ul className="grid gap-2 text-body">
        {factors.map((factor) => (
          <li key={factor.id} className="rounded-lg border px-3.5 py-3">
            <span className="font-medium">{factor.name}</span>
            <span className="text-muted-foreground"> · added {formatDate(factor.createdAt)}</span>
          </li>
        ))}
      </ul>
      {factors.length < MAX_TOTP_FACTORS ? (
        <section aria-labelledby="mfa-backup-heading" className="grid gap-4">
          <h2 id="mfa-backup-heading" className="text-lg font-semibold">
            Add a backup device
          </h2>
          <p className="text-body text-muted-foreground">
            A second authenticator on another device lets you log in if you lose the first one.
          </p>
          <BackupFactorForm key={factors.length} />
        </section>
      ) : (
        <p className="text-body text-muted-foreground">{TOO_MANY_FACTORS}</p>
      )}
      <TextLink standalone="flush" href={home}>
        Continue
      </TextLink>
    </AuthCard>
  );
}
