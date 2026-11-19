import type { Json } from "@chara-pinnacle/db-types";
import { limitText } from "@/lib/validation/plan-editor";

type HistoryValues = { from: string; to: string };

type HistoryEntry = { table: string; operation: string; before: Json; after: Json };

function record(value: Json): Record<string, Json | undefined> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function columnText(column: string, value: Json | undefined): string {
  if (value === undefined) return "Not set";
  if (column === "is_public") return value ? "Public" : "Not public";
  if (column === "contact_sales") return value ? "Yes" : "No";
  if (column === "limit_value") return typeof value === "number" || value === null ? limitText(value) : String(value);
  return value === null ? "None" : String(value);
}

// The old and new value of a plan history row as the console shows them (FR-R2 AC11): a limit as a number or Unlimited,
// a feature as On or Off, a changed plan column by its value (several columns by name and value).
export function historyValues({ table, operation, before, after }: HistoryEntry): HistoryValues {
  if (table === "plan_features") {
    return operation === "delete" ? { from: "On", to: "Off" } : { from: "Off", to: "On" };
  }
  const old = record(before);
  const next = record(after);
  if (table === "plan_limits") {
    return { from: old ? columnText("limit_value", old.limit_value) : "Not set", to: next ? columnText("limit_value", next.limit_value) : "Removed" };
  }
  const columns = Object.keys(operation === "update" ? (next ?? {}) : {});
  if (columns.length === 0) return { from: old ? "Existing row" : "None", to: next ? "Created" : "Removed" };
  const describe = (row: Record<string, Json | undefined> | null) =>
    columns.length === 1
      ? columnText(columns[0], row?.[columns[0]])
      : columns.map((column) => `${column}: ${columnText(column, row?.[column])}`).join(", ");
  return { from: describe(old), to: describe(next) };
}
