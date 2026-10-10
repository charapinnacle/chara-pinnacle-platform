import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { ChallengeForm } from "@/components/mfa/challenge-form";
import { EnrolmentStartForm } from "@/components/mfa/enrolment-start-form";
import { listVerifiedFactors } from "@/lib/dal/mfa";
import { requireUser } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { homePath } from "@/lib/routes";
import { mfaReturnPath } from "@/lib/safe-next";
import { MAX_TOTP_FACTORS, TOO_MANY_FACTORS } from "@/lib/validation/mfa";

export const metadata: Metadata = { title: "Two-step verification — CHARA", robots: { index: false } };

export default async function MfaPage({ params, searchParams }: PageProps<"/[lang]/mfa">) {
  const { lang } = await params;
  const { next } = await searchParams;
  const user = await requireUser(lang);
  const nextPath = typeof next === "string" ? next : undefined;
  const home = homePath(lang, user.accountKind);
  const factors = await listVerifiedFactors(lang);

  if (factors.length === 0) {
    return (
      <AuthCard
        icon={ShieldCheck}
        title="Set up two-step verification"
        description="You scan a QR code with an authenticator app such as Google Authenticator, 1Password or Authy, then enter the code it shows."
      >
        <EnrolmentStartForm first next={nextPath} />
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
        <ChallengeForm devices={factors} next={nextPath} />
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
          <h2 id="mfa-backup-heading" className="text-h2">
            Add a backup device
          </h2>
          <p className="text-body text-muted-foreground">
            A second authenticator on another device lets you log in if you lose the first one.
          </p>
          <EnrolmentStartForm key={factors.length} />
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
