import { cn } from "@/lib/utils";

const labels = { active: "Active", suspended: "Suspended", deletion_pending: "Deletion pending" } as const;

export function StatusBadge({ status }: { status: "active" | "suspended" | "deletion_pending" }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border px-2 py-0.5 text-small font-medium",
        status === "suspended" ? "border-destructive/30 bg-destructive-surface text-foreground" : "bg-accent text-accent-foreground",
      )}
    >
      {labels[status]}
    </span>
  );
}
