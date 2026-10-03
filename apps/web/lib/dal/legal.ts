import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  AGE_ATTESTATION_SLUG,
  consentEntriesSchema,
  unacceptedDocuments,
  type LegalDocumentSummary,
} from "@/lib/validation/consents";

type AccountKind = Database["public"]["Enums"]["account_kind"];

type DocumentRow = {
  slug: string;
  title: string;
  version: number;
  published_at: string;
  change_summary: string;
};

type DocumentsToAccept = {
  documents: LegalDocumentSummary[];
  attestationWording: string | null;
};

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function toSummary(row: DocumentRow): LegalDocumentSummary {
  return {
    slug: row.slug,
    title: row.title,
    version: row.version,
    publishedAt: row.published_at,
    changeSummary: row.change_summary,
  };
}

export async function getSignupDocuments(
  kind: AccountKind,
): Promise<LegalDocumentSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("signup_documents", {
    p_kind: kind,
  });
  if (error) throw new Error("The sign-up documents could not be loaded");
  return data.map(toSummary);
}

async function getAttestationWording(
  documents: readonly LegalDocumentSummary[],
): Promise<string | null> {
  const attestation = documents.find(
    (document) => document.slug === AGE_ATTESTATION_SLUG,
  );
  if (!attestation) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legal_documents")
    .select("body")
    .eq("slug", attestation.slug)
    .eq("version", attestation.version)
    .single();
  if (error) throw new Error("The age wording could not be loaded");
  return data.body;
}

export async function getSignUpForm() {
  const [worker, company] = await Promise.all([
    getSignupDocuments("worker"),
    getSignupDocuments("company"),
  ]);
  return {
    documents: { worker, company },
    attestationWording: await getAttestationWording(worker),
  };
}

export async function getOnboardingDocuments(
  kind: AccountKind,
): Promise<DocumentsToAccept> {
  const supabase = await createClient();
  const [documents, { data: profile, error }] = await Promise.all([
    getSignupDocuments(kind),
    supabase.from("profiles").select("pending_consents").single(),
  ]);
  if (error) throw new Error("The sign-up consents could not be loaded");
  const entries = consentEntriesSchema.safeParse(profile.pending_consents);
  const stale = unacceptedDocuments(
    documents,
    entries.success ? entries.data : [],
  );
  return { documents: stale, attestationWording: await getAttestationWording(stale) };
}

export const getPendingReconsents = cache(
  async (): Promise<LegalDocumentSummary[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("pending_reconsents");
    if (error) throw new Error("The pending consents could not be loaded");
    return data.map(toSummary);
  },
);

export async function getLegalDocument(slug: string) {
  if (!SLUG_PATTERN.test(slug)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legal_documents")
    .select("title, version, body, published_at")
    .eq("slug", slug)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("The legal document could not be loaded");
  if (!data?.published_at) return null;
  return {
    title: data.title,
    version: data.version,
    body: data.body,
    publishedAt: data.published_at,
  };
}
