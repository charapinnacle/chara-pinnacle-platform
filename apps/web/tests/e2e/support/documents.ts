import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { env } from "@/lib/env";
import { execute, literal, query } from "./db";
import { waitForHydration } from "./hydration";
import { signIn } from "./passport";
import { expect } from "./test";
import type { TestUser } from "./test-user";

export const BUCKET = "passport-documents";

// A file of exactly this many bytes that starts like a PDF.
export function pdfBytes(size: number): Buffer {
  const bytes = Buffer.alloc(size, 0x20);
  bytes.write("%PDF-1.7\n");
  return bytes;
}

export const FAKE_PDF = Buffer.from("This is plain text, not a PDF.");

export interface DocumentRow {
  id: string;
  type: string;
  title: string;
  bucket_id: string;
  storage_path: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  scan_status: string;
  expires_on: string | null;
  deleted_at: string | null;
}

export function documentRows(userId: string): DocumentRow[] {
  return query<DocumentRow>(
    `select id, type::text, title, bucket_id, storage_path, file_name, mime, size_bytes, scan_status, expires_on::text,
            deleted_at::text
     from public.worker_documents where worker_user_id = ${literal(userId)} order by created_at, id`,
  );
}

export function objectNames(userId: string): string[] {
  return query<{ name: string }>(
    `select name from storage.objects where bucket_id = ${literal(BUCKET)} and name like ${literal(`${userId}/%`)} order by name`,
  ).map((row) => row.name);
}

export function auditActions(documentId: string): string[] {
  return query<{ action: string }>(
    `select action from audit.log where entity_type = 'worker_documents' and entity_id = ${literal(documentId)} order by id`,
  ).map((row) => row.action);
}

export function removalJobs(path: string): number {
  const [row] = query<{ n: number }>(
    `select count(*)::int as n from pgmq.q_account_ops
     where message ->> 'action' = 'delete_object' and message ->> 'path' = ${literal(path)}`,
  );
  return row.n;
}

interface SeedOptions {
  title: string;
  type?: "cv" | "certificate";
  scanStatus?: string;
  expiresOn?: string | null;
  createdAt?: string;
  fileName?: string;
  sizeBytes?: number;
  object?: boolean;
}

// A document row as the platform would hold it after a finished upload. The trigger that checks the expiry window also
// fires for the table owner, so a date that has passed is allowed (the window only limits the future).
export async function seedDocument(userId: string, options: SeedOptions): Promise<DocumentRow> {
  const id = randomUUID();
  const fileName = options.fileName ?? "My_CV__final_.pdf";
  const path = `${userId}/${id}/${fileName}`;
  const size = options.sizeBytes ?? 1_258_291;
  execute(
    `insert into public.worker_documents (id, worker_user_id, type, title, storage_path, file_name, mime, size_bytes, scan_status, expires_on, created_at)
     values (${literal(id)}, ${literal(userId)}, ${literal(options.type ?? "cv")}, ${literal(options.title)}, ${literal(path)},
             ${literal(fileName)}, 'application/pdf', ${size}, ${literal(options.scanStatus ?? "skipped")},
             ${options.expiresOn ? literal(options.expiresOn) : "null"}, ${options.createdAt ? literal(options.createdAt) : "now()"})`,
  );
  if (options.object !== false) await putObject(path, pdfBytes(Math.min(size, 4096)));
  return documentRows(userId).find((row) => row.id === id) as DocumentRow;
}

// The secret key of the local stack plays the platform: a person can only upload through a signed link.
export async function putObject(path: string, bytes: Buffer, mimetype = "application/pdf"): Promise<void> {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: process.env.E2E_AUTH_ADMIN_KEY ?? "", "content-type": mimetype },
    body: new Uint8Array(bytes),
  });
  if (!response.ok) throw new Error(`Storage answered ${response.status} for ${path}`);
}

// The browser tests play the database webhook: they send scan-document the payload that the trigger on storage.objects
// would queue (supabase/functions/serve-local.sh starts the process; playwright.config.ts defines the port).
export async function runScanDocument(path: string): Promise<{ status: string }> {
  const [object] = query<{ id: string; metadata: { mimetype?: string } }>(
    `select id, metadata from storage.objects where bucket_id = ${literal(BUCKET)} and name = ${literal(path)}`,
  );
  const response = await fetch(`http://127.0.0.1:${process.env.SCAN_DOCUMENT_PORT}`, {
    method: "POST",
    headers: { "x-edge-secret": process.env.EDGE_SHARED_SECRET ?? "", "content-type": "application/json" },
    body: JSON.stringify({
      type: "INSERT",
      schema: "storage",
      table: "objects",
      record: { id: object.id, bucket_id: BUCKET, name: path, metadata: object.metadata },
    }),
  });
  if (!response.ok) throw new Error(`scan-document answered ${response.status}`);
  return (await response.json()) as { status: string };
}

export async function openDocuments(page: Page, user: TestUser): Promise<void> {
  await signIn(page, user);
  await page.goto("/en/passport");
  await expect(page.getByRole("heading", { name: "Documents", level: 2, exact: true })).toBeVisible({ timeout: 15_000 });
  await waitForHydration(page.getByLabel("Type", { exact: true }));
}

// The live region of the upload form that announces the chosen file and the result of an upload.
export const announcements = (page: Page) => page.locator('form [aria-live="polite"]');

export function row(page: Page, title: string) {
  return page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: title, exact: true }) });
}
