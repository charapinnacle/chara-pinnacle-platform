import "server-only";
import { getPublicSettings } from "@/lib/dal/settings";

// The release switches of Phase 2 (DATA_MODEL.md section 1): off until go-live, read on every request.
export type ReleaseSwitch = "release_partner_directories";

export async function isReleased(name: ReleaseSwitch): Promise<boolean> {
  return (await getPublicSettings())[name] === "true";
}
