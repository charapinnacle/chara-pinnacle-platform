"use server";

import type { NetworkStatistics } from "@/lib/admin/network-statistics";
import { networkStatistics } from "@/lib/dal/admin";
import { requirePlatformRole } from "@/lib/dal/session";
import { defaultLocale } from "@/lib/i18n/locale";
import { networkStatisticsSchema, type NetworkStatisticsForm } from "@/lib/validation/admin";

export type NetworkStatisticsAnswer = { ok: true; statistics: NetworkStatistics } | { ok: false };

// The partner network section of the statistics page (FR-S2). A refusal or a failure of the database is a failure the
// page shows with a retry; only the code of the cause is logged.
export async function networkStatisticsAction(input: NetworkStatisticsForm): Promise<NetworkStatisticsAnswer> {
  await requirePlatformRole(defaultLocale, ["admin"]);
  const parsed = networkStatisticsSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  try {
    return { ok: true, statistics: await networkStatistics(parsed.data) };
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    console.error("The partner network statistics failed", {
      code: typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined,
    });
    return { ok: false };
  }
}
