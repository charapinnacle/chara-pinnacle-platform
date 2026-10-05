import type { Database } from "@chara-pinnacle/db-types";
import { z } from "zod";
import { parseDate } from "@/lib/validation/passport";

type DocumentType = Database["public"]["Enums"]["worker_document_type"];

// The same limits as the table constraints, the bucket and its policies; the database stays the authority.
export const DOCUMENT_BUCKET = "passport-documents";
export const MAX_FILE_BYTES = 15_728_640;
const MAX_TITLE_LENGTH = 120;
const MAX_FILE_NAME_LENGTH = 100;
const CONTROL_CHARACTER = /[\p{Cc}\p{Zl}\p{Zp}]/u;

const documentTypes = ["cv", "certificate"] as const satisfies readonly DocumentType[];

export const documentTypeOptions = [
  { value: "cv", label: "CV" },
  { value: "certificate", label: "Certificate" },
] as const satisfies readonly { value: (typeof documentTypes)[number]; label: string }[];

const FILE_TYPE_MESSAGE = "Choose a PDF, JPG or PNG file.";

const allowedFiles: Record<string, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
};

export const acceptedExtensions = Object.values(allowedFiles)
  .flat()
  .map((extension) => `.${extension}`)
  .join(",");

// Every character outside A-Z, a-z, 0-9, dot, underscore and hyphen becomes an underscore, and the name keeps its
// extension within 100 characters. The result is what the storage path and file_name constraint accept.
export function sanitiseFileName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_");
  if (safe.length <= MAX_FILE_NAME_LENGTH) return safe;
  const dot = safe.lastIndexOf(".");
  const extension = dot === -1 ? "" : safe.slice(dot);
  return safe.slice(0, MAX_FILE_NAME_LENGTH - extension.length) + extension;
}

const titleSchema = z
  .string({ error: "Enter a title." })
  .trim()
  .min(1, { error: "Enter a title." })
  .max(MAX_TITLE_LENGTH, { error: `The title can have up to ${MAX_TITLE_LENGTH} characters.` })
  .refine((value) => !CONTROL_CHARACTER.test(value), { error: "The title must be one line of plain text." });

export const renameFormSchema = z.object({ title: titleSchema });
export type RenameInput = z.input<typeof renameFormSchema>;

const CHOOSE_FILE = "Choose a file.";

type FileInfo = { name: string; size: number; type: string };

function checkFile(context: z.core.ParsePayload<FileInfo>) {
  const { name, size, type } = context.value;
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const issue = (message: string) => context.issues.push({ code: "custom", input: context.value, message });
  if (size === 0) issue("The file is empty.");
  else if (size > MAX_FILE_BYTES) issue("File is larger than 15 MB");
  else if (!name.includes(".") || !allowedFiles[type]?.includes(extension)) issue(FILE_TYPE_MESSAGE);
}

const expiryText = z
  .string()
  .trim()
  .refine((value) => value === "" || parseDate(value) !== null, { error: "Choose a valid date." });

const TYPE_MESSAGE = "Choose a type.";

// What the browser form and the Server Action both check. The form holds the chosen File and the action receives only its
// name, size and type, so one description of an acceptable file serves both. An expiry date belongs to a certificate; one
// typed before the type was changed to CV is dropped.
const uploadFields = { title: titleSchema, expiresOn: expiryText };

export const uploadFormSchema = z.object({
  type: z.string({ error: TYPE_MESSAGE }).refine((value) => documentTypes.some((type) => type === value), { error: TYPE_MESSAGE }),
  ...uploadFields,
  file: z.instanceof(File, { error: CHOOSE_FILE }).check(checkFile),
});
export type UploadFormInput = z.input<typeof uploadFormSchema>;

export const uploadSchema = z
  .object({
    type: z.enum(documentTypes, { error: TYPE_MESSAGE }),
    ...uploadFields,
    file: z.object({ name: z.string(), size: z.number(), type: z.string() }, { error: CHOOSE_FILE }).check(checkFile),
  })
  .transform((value) => ({
    ...value,
    expiresOn: value.type === "certificate" && value.expiresOn !== "" ? value.expiresOn : null,
  }));
export type UploadInput = Omit<z.input<typeof uploadSchema>, "type"> & { type: string };

export const documentIdSchema = z.uuid();
