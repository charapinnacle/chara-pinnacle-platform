import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConsentForm } from "@/components/consent/consent-form";
import { acceptReconsents } from "@/lib/actions/consents";
import { getPendingReconsents } from "@/lib/dal/legal";
import { requireUser } from "@/lib/dal/session";
import { consentReturnPath } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Updated documents — CHARA" };

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
    <div className="grid max-w-xl gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Our documents have changed
      </h1>
      <p>Accept the current version of each document below to continue.</p>
      <ConsentForm
        documents={pending}
        attestationWording={null}
        submitLabel="Accept and continue"
        onAccept={acceptReconsents.bind(null, nextPath)}
      />
    </div>
  );
}
