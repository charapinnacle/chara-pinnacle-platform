"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { requireUser } from "@/lib/dal/session";
import { isUsableScanStatus } from "@/lib/documents/presentation";
import { defaultLocale } from "@/lib/i18n/locale";
import { homePath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import {
  DOCUMENT_BUCKET,
  documentIdSchema,
  renameFormSchema,
  sanitiseFileName,
  uploadSchema,
  type RenameInput,
  type UploadInput,
} from "@/lib/validation/documents";
import { fieldErrors, type FieldErrors } from "@/lib/validation/sign-up";

type DocumentResult = { errors?: FieldErrors; message?: string };
type UploadTicket = DocumentResult & { upload?: { documentId: string; path: string; token: string } };
type DownloadResult = DocumentResult & { url?: string };

const FAR_AHEAD = "Choose a date that is not too far ahead.";

function refusal(error: PostgrestError): DocumentResult {
  if (error.message === "CHARA_INVALID_INPUT" && error.details === "expires_on") return { errors: { expiresOn: FAR_AHEAD } };
  console.error("Document action failed", { code: error.code, message: error.message });
  return { message: GENERIC_FAILURE };
}

// The reminders on the dashboard show the title and the expiry date.
function settle(): DocumentResult {
  revalidatePath(homePath(defaultLocale, "worker"));
  return {};
}

// Metadata first: the row exists before any byte is sent. The browser then sends the file straight to Storage through the
// signed upload URL, which is minted with the candidate's own session, so the storage insert policy decides. The id is
// chosen here because the storage path carries it; a row whose upload never finishes stays pending until it is deleted.
export async function startDocumentUpload(input: UploadInput): Promise<UploadTicket> {
  const { id: userId } = await requireUser(defaultLocale);
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { type, title, expiresOn, file } = parsed.data;

  const documentId = crypto.randomUUID();
  const fileName = sanitiseFileName(file.name);
  const path = `${userId}/${documentId}/${fileName}`;
  const supabase = await createClient();
  const { error } = await supabase.from("worker_documents").insert({
    id: documentId,
    worker_user_id: userId,
    type,
    title,
    storage_path: path,
    file_name: fileName,
    mime: file.type,
    size_bytes: file.size,
    expires_on: expiresOn,
  });
  if (error) return refusal(error);

  const { data, error: signError } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (signError) {
    console.error("Document upload link failed", { message: signError.message });
    return { message: GENERIC_FAILURE };
  }
  settle();
  return { upload: { documentId, path: data.path, token: data.token } };
}

export async function renameDocument(documentId: string, input: RenameInput): Promise<DocumentResult> {
  const { id: userId } = await requireUser(defaultLocale);
  const id = documentIdSchema.safeParse(documentId);
  const parsed = renameFormSchema.safeParse(input);
  if (!id.success) return { message: GENERIC_FAILURE };
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("worker_documents")
    .update({ title: parsed.data.title })
    .eq("id", id.data)
    .eq("worker_user_id", userId)
    .select("id");
  if (error) return refusal(error);
  if (data.length === 0) return { message: "This document no longer exists." };
  return settle();
}

export async function deleteDocument(documentId: string): Promise<DocumentResult> {
  await requireUser(defaultLocale);
  const id = documentIdSchema.safeParse(documentId);
  if (!id.success) return { message: GENERIC_FAILURE };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_worker_document", { p_document_id: id.data });
  if (error && error.code !== "P0002") return refusal(error);
  return settle();
}

// A link that lives 60 seconds and makes the browser save the file instead of showing it. Only a document that passed the
// check is offered: the candidate's row policy finds the row and the storage select policy lets the session sign the path.
export async function getDocumentDownload(documentId: string): Promise<DownloadResult> {
  await requireUser(defaultLocale);
  const id = documentIdSchema.safeParse(documentId);
  if (!id.success) return { message: GENERIC_FAILURE };
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("worker_documents")
    .select("storage_path, file_name, scan_status")
    .eq("id", id.data)
    .maybeSingle();
  if (error) return refusal(error);
  if (!row) return { message: "This document no longer exists." };
  if (!isUsableScanStatus(row.scan_status)) {
    return { message: "This file cannot be downloaded." };
  }
  const { data, error: signError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(row.storage_path, 60, { download: row.file_name });
  if (signError) {
    console.error("Document download link failed", { message: signError.message });
    return { message: GENERIC_FAILURE };
  }
  return { url: data.signedUrl };
}
