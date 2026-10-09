export type UsageState = "ok" | "at_limit" | "over_limit" | "unlimited";

type UsageLevel = { state: UsageState; label: string; percent: number | null };

// How full a limit is. A null limit is unlimited. Usage above the limit stays above it (a downgrade keeps the data,
// FR-G5 C9), and a limit of 0 is full at 0, so the bar never divides by zero.
export function classifyUsage(used: number, limit: number | null): UsageLevel {
  if (limit === null) return { state: "unlimited", label: "Unlimited", percent: null };
  const state = used > limit ? "over_limit" : used === limit ? "at_limit" : "ok";
  return { state, label: `${used} of ${limit}`, percent: limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100)) };
}
