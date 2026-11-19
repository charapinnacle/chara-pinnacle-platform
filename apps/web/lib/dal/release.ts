import "server-only";
import { unstable_rethrow } from "next/navigation";
import { getPublicSettings } from "@/lib/dal/settings";
import { releaseSwitches, type ReleaseSwitch } from "@/lib/release";

export type { ReleaseSwitch } from "@/lib/release";

// The release switches of Phase 2 (DATA_MODEL.md section 1): off until go-live, read on every request.
export async function isReleased(name: ReleaseSwitch): Promise<boolean> {
  return (await getPublicSettings())[name] === "true";
}

// The switches that are on, for a page that only adapts to a release (the header menu, the pricing page, the sections
// about partners): a failed read counts every switch as off, so the page is still served (FR-H1 AC8) as it was before the
// release. What Next.js throws to stop a render (a dynamic read during the build) is passed on.
export async function releasedSwitches(): Promise<ReleaseSwitch[]> {
  try {
    const settings = await getPublicSettings();
    return releaseSwitches.filter((name) => settings[name] === "true");
  } catch (error) {
    unstable_rethrow(error);
    console.error("The release switches could not be read", error);
    return [];
  }
}
