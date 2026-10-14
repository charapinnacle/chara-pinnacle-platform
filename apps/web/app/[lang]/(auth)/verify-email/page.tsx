import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { CheckEmailPanel } from "@/components/auth/check-email-panel";
import { ResendForm } from "@/components/auth/resend-form";
import { AuthCard, cardDividerClassName } from "@/components/layout/auth-card";
import { changeSignupAddress, resendSignupEmail } from "@/lib/actions/auth";
import { cooldownLeft, maskEmail, pendingEmail } from "@/lib/pending-email";

export const metadata: Metadata = { title: "Check your email" };

const SENT =
  "If the address can be used for a new account, we have sent a confirmation link. The link is valid for 24 hours and works once. Confirm your email address before you log in.";

// After sign-up the address comes from the cookie the sign-up set, so the page offers a plain Resend button; a person who
// arrives without it (a bookmark, another browser, an expired link) is asked for the address, as before.
export default async function VerifyEmailPage({ searchParams }: PageProps<"/[lang]/verify-email">) {
  const { error } = await searchParams;
  const invalidLink = error === "invalid_link";
  const pending = invalidLink ? null : await pendingEmail("signup");
  if (pending) {
    return (
      // True for every address (D89): a new account gets the confirmation link, an existing one an email with a sign-in link.
      <AuthCard
        icon={Mail}
        title="Check your email"
        description={`We have sent an email to ${maskEmail(pending.email)}. It contains the next step: a confirmation link for a new account, or a sign-in link if you already have one.`}
      >
        <p className="text-center text-small text-muted-foreground text-balance">
          A confirmation link is valid for 24 hours and works once. Confirm your email address before you log in.
        </p>
        <CheckEmailPanel
          initialCooldown={cooldownLeft(pending.sentAt)}
          resend={resendSignupEmail}
          changeAddress={changeSignupAddress}
        />
      </AuthCard>
    );
  }
  return (
    <AuthCard
      icon={Mail}
      title={invalidLink ? "This link is invalid or has expired." : "Check your email"}
      description={invalidLink ? "Enter your email address to request a new confirmation link." : SENT}
    >
      <div className={cardDividerClassName}>
        <ResendForm />
      </div>
    </AuthCard>
  );
}
