import { revalidatePath } from "next/cache";
import { defaultLocale } from "@/lib/i18n/locale";

// The header of the signed-in area is drawn by a layout, which does not run again when a person moves from page to page.
// An action that changes what the header offers (the account kind, the organisations) asks for it to be drawn again.
export function refreshAppShell(): void {
  revalidatePath(`/${defaultLocale}`, "layout");
}
