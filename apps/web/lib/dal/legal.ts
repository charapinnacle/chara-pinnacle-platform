import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { cache } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  AGE_ATTESTATION_SLUG,
  consentEntriesSchema,
  unacceptedDocuments,
  type LegalDocumentSummary,
} from "@/lib/validation/consents";

type AccountKind = Database["public"]["Enums"]["account_kind"];

type DocumentRow =
  Database["public"]["Functions"]["signup_documents"]["Returns"][number];

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
  if (error) throw new Error("The sign-up documents could not be loaded", { cause: error });
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
  if (error) throw new Error("The age wording could not be loaded", { cause: error });
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
  if (error) throw new Error("The sign-up consents could not be loaded", { cause: error });
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
    if (error) throw new Error("The pending consents could not be loaded", { cause: error });
    return data.map(toSummary);
  },
);

const currentVersion = z.object({
  title: z.string(),
  version: z.number(),
  body: z.string(),
  change_summary: z.string(),
  published_at: z.string(),
  is_draft: z.boolean(),
});

const CHANGE_LOG_LIMIT = 100;

type ChangeLogEntry = { version: number; publishedAt: string; changeSummary: string; isDraft: boolean };

// The current version is the highest published one (v_legal_current); the change log lists the published versions,
// newest first, the latest CHANGE_LOG_LIMIT of them (one more is read to know that older ones exist; the export holds
// them all). Cached because the page and its metadata both read it in one request.
export const getLegalDocument = cache(async (slug: string) => {
  if (!SLUG_PATTERN.test(slug)) return null;
  const supabase = await createClient();
  const [current, log] = await Promise.all([
    supabase
      .from("v_legal_current")
      .select("title, version, body, change_summary, published_at, is_draft")
      .eq("slug", slug)
      .maybeSingle(),
    supabase
      .from("legal_documents")
      .select("version, published_at, change_summary, is_draft")
      .eq("slug", slug)
      .order("version", { ascending: false })
      .limit(CHANGE_LOG_LIMIT + 1),
  ]);
  if (current.error) throw new Error("The legal document could not be loaded", { cause: current.error });
  if (log.error) throw new Error("The change log could not be loaded", { cause: log.error });
  if (!current.data) return null;
  const document = currentVersion.parse(current.data);
  const changeLog = log.data.slice(0, CHANGE_LOG_LIMIT).flatMap((row): ChangeLogEntry[] =>
    row.published_at
      ? [{ version: row.version, publishedAt: row.published_at, changeSummary: row.change_summary, isDraft: row.is_draft }]
      : [],
  );
  return {
    title: document.title,
    version: document.version,
    body: document.body,
    changeSummary: document.change_summary,
    publishedAt: document.published_at,
    isDraft: document.is_draft,
    changeLog,
    changeLogTruncated: log.data.length > CHANGE_LOG_LIMIT,
  };
});
