"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { GENERIC_FAILURE } from "@/lib/auth-errors";
import { requestRefusal } from "@/lib/data-export/presentation";
import { requestDataExportLink } from "@/lib/dal/data-export";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { dataExportPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "Data exports are not available at the moment.";

// The signed-in user asks for a copy of their data (FR-S3 AC8). The database allows one request per interval and says
// when the next one is accepted.
export async function requestDataExport(): Promise<{ message?: string }> {
  await requireUser(defaultLocale, { consentGate: false });
  if (!(await isReleased("release_data_export"))) return { message: UNAVAILABLE };
  const { error } = await (await createClient()).rpc("request_data_export");
  if (error) {
    if (error.message === "CHARA_RATE_LIMITED") {
      return { message: requestRefusal(error.details, error.hint) ?? GENERIC_FAILURE };
    }
    if (error.message === "CHARA_FORBIDDEN" && error.details === "release_off") return { message: UNAVAILABLE };
    console.error("Requesting a data export failed", { code: error.code, message: /^CHARA_[A-Z_]+$/.test(error.message) ? error.message : undefined });
    return { message: GENERIC_FAILURE };
  }
  revalidatePath(dataExportPath(defaultLocale));
  return {};
}

// A 10-minute link to a ready export of the caller; the database records the download.
export async function downloadDataExport(exportId: string): Promise<{ message?: string; url?: string }> {
  const id = z.uuid().safeParse(exportId);
  if (!id.success) return { message: GENERIC_FAILURE };
  await requireUser(defaultLocale, { consentGate: false });
  const link = await requestDataExportLink(id.data);
  if ("url" in link) return { url: link.url };
  if (link.refusal === "unavailable") return { message: "This export is no longer available. Ask for a new one." };
  if (link.refusal === "rate_limited") return { message: "Too many files were opened in a short time. Wait a minute and try again." };
  return { message: GENERIC_FAILURE };
}
