import { cn } from "@/lib/utils";

// The employer's mark in the search: no logos are uploaded in Phase 1, so a dark tile carries the name, or the first
// letters of a longer one.
function markText(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 4) return trimmed.toUpperCase();
  return trimmed
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export function EmployerMark({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center bg-inverse font-semibold tracking-wide text-brand",
        size === "lg" ? "size-14 rounded-2xl text-small" : "size-11 rounded-xl text-caption",
      )}
    >
      {markText(name)}
    </span>
  );
}
