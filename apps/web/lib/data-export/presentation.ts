import type { StatusTone } from "@/lib/status-tone";
import { formatDateTime } from "@/lib/i18n/format";

// The states of a request for a copy of the user's data, as list_my_data_exports names them (FR-S3 AC8).
export const exportStates = ["preparing", "ready", "expired", "failed"] as const;
export type ExportState = (typeof exportStates)[number];

export function isExportState(value: string): value is ExportState {
  return (exportStates as readonly string[]).includes(value);
}

export const exportStateLabels: Record<ExportState, string> = {
  preparing: "Being prepared",
  ready: "Ready to download",
  expired: "Expired",
  failed: "Could not be prepared",
};

export const exportStateTones: Record<ExportState, StatusTone> = {
  preparing: "info",
  ready: "success",
  expired: "neutral",
  failed: "danger",
};

export const EXPORT_PENDING = "An export is already being prepared. We will email you when it is ready.";

// What a refused request says: one in preparation, or the time from which a new one is accepted (the database's hint).
export function requestRefusal(details: string | undefined, hint: string | undefined): string | null {
  if (details === "export_pending") return EXPORT_PENDING;
  if (details === "export_recent") {
    return hint && !Number.isNaN(Date.parse(hint))
      ? `You can ask for a new export from ${formatDateTime(hint)}.`
      : "You asked for an export recently. Try again later.";
  }
  return null;
}

const sizeFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

// 2048 -> "2 KB", 5_400_000 -> "5.1 MB".
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} KB`;
  return `${sizeFormat.format(bytes / (1024 * 1024))} MB`;
}
