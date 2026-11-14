import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConsentForm } from "@/components/consent/consent-form";
import { Card, CardHeader } from "@/components/layout/card";
import { acceptReconsents } from "@/lib/actions/consents";
import { getPendingReconsents } from "@/lib/dal/legal";
import { requireUser } from "@/lib/dal/session";
import { consentReturnPath } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Updated documents" };

export default async function ConsentPage({
  params,
  searchParams,
}: PageProps<"/[lang]/consent">) {
  const { lang } = await params;
  const { next } = await searchParams;
  await requireUser(lang, { consentGate: false });

  const nextPath = typeof next === "string" ? next : "";
  const pending = await getPendingReconsents();
  if (pending.length === 0) redirect(consentReturnPath(lang, nextPath));

  return (
    <div className="grid flex-1 place-items-center">
      <Card elevated padding="lg" className="w-full max-w-md gap-5 rounded-card">
        <CardHeader>
          <h1 className="text-h2 text-balance">Our documents have changed</h1>
          <p className="text-small text-pretty text-muted-foreground">
            Accept the current version of each document below to continue.
          </p>
        </CardHeader>
        <ConsentForm
          documents={pending}
          attestationWording={null}
          submitLabel="Accept and continue"
          onAccept={acceptReconsents.bind(null, nextPath)}
        />
      </Card>
    </div>
  );
}
