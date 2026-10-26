import type { SupabaseClient } from "@supabase/supabase-js";
import { isObject } from "../_shared/http.ts";
import { zip, type ZipEntry } from "./zip.ts";

export const EXPORT_BUCKET = "dsar-exports";
const PASSPORT_BUCKET = "passport-documents";
// The document files of one export stay within this many bytes, so the archive fits the bucket limit (50 MB) and the
// memory of the function. A document past it is listed without its file; the candidate still has it in the passport.
const FILES_BUDGET = 40 * 1024 * 1024;
const LEFT_OUT = "Not included in this copy because of its size. Download it from your passport.";

interface ExportFile {
  path: string;
  name: string;
  size: number;
}

interface ExportData {
  sections: Record<string, unknown>;
  files: ExportFile[];
}

// What account_ops_export_data returns for the user the job names; anything else is refused before a file is read.
function parseExport(data: unknown, userId: string): ExportData | null {
  if (!isObject(data) || data.user_id !== userId || !isObject(data.sections) || !Array.isArray(data.files)) {
    return null;
  }
  const files: ExportFile[] = [];
  for (const file of data.files) {
    if (
      !isObject(file) || file.bucket_id !== PASSPORT_BUCKET || typeof file.path !== "string" ||
      !file.path.startsWith(`${userId}/`) || file.path.includes("..") || typeof file.name !== "string" ||
      typeof file.size_bytes !== "number"
    ) {
      return null;
    }
    files.push({ path: file.path, name: file.name, size: file.size_bytes });
  }
  return { sections: data.sections, files };
}

// A file that is gone (deleted between the read and the download) is left out like one past the budget.
async function download(client: SupabaseClient, path: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const { data, error } = await client.storage.from(PASSPORT_BUCKET).download(path);
  if (error) {
    // Storage answers a missing object with HTTP 400 and the status code "404" in the body.
    const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
    if (status === 404 || statusCode === "404") {
      return null;
    }
    throw error;
  }
  return new Uint8Array(await data.arrayBuffer());
}

function json(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${JSON.stringify(value ?? null, null, 2)}\n`);
}

// The copy of a user's data (FR-S3 AC7, AC8): one UTF-8 JSON file per section and the user's own document files, in one
// zip at <user>/<request>.zip of the private bucket. The request is marked ready only once the file is there; when it
// is not queued any more by then (the account was erased meanwhile), the file is removed again. A job read again after
// the request became ready builds nothing.
export async function buildExport(
  client: SupabaseClient,
  userId: string,
  exportId: string,
  now: Date = new Date(),
): Promise<Record<string, number>> {
  const { data, error } = await client.rpc("account_ops_export_data", { p_export: exportId });
  if (error) {
    throw error;
  }
  if (data === null) {
    return { export_built: 0 };
  }
  const parsed = parseExport(data, userId);
  if (!parsed) {
    throw new Error("unexpected export data");
  }

  const fileEntries: ZipEntry[] = [];
  const included = new Set<string>();
  let budget = FILES_BUDGET;
  for (const file of parsed.files) {
    if (file.size > budget) {
      continue;
    }
    const bytes = await download(client, file.path);
    if (bytes && bytes.length <= budget) {
      budget -= bytes.length;
      fileEntries.push({ name: file.name, data: bytes, deflate: false });
      included.add(file.name);
    }
  }

  const sections = { ...parsed.sections };
  if (Array.isArray(sections.documents)) {
    sections.documents = sections.documents.map((document) =>
      isObject(document) && typeof document.file === "string" && !included.has(document.file)
        ? { ...document, file: null, note: LEFT_OUT }
        : document
    );
  }
  const entries: ZipEntry[] = [
    ...Object.entries(sections).map(([key, value]) => ({ name: `${key}.json`, data: json(value), deflate: true })),
    ...fileEntries,
  ];
  const archive = await zip(entries, now);

  const path = `${userId}/${exportId}.zip`;
  const bucket = client.storage.from(EXPORT_BUCKET);
  const upload = await bucket.upload(path, archive, { contentType: "application/zip", upsert: true });
  if (upload.error) {
    throw upload.error;
  }
  const ready = await client.rpc("account_ops_export_ready", { p_export: exportId, p_size: archive.length });
  if (ready.error) {
    throw ready.error;
  }
  if (ready.data !== true) {
    const removed = await bucket.remove([path]);
    if (removed.error) {
      throw removed.error;
    }
    return { export_built: 0 };
  }
  return {
    export_built: 1,
    files_included: fileEntries.length,
    files_left_out: parsed.files.length - fileEntries.length,
    size_bytes: archive.length,
  };
}
