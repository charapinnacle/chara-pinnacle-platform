import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// A light band passes over the grey block instead of the pulse; it stops under prefers-reduced-motion.
export const shimmerClassName =
  "relative animate-none overflow-hidden before:absolute before:inset-0 before:animate-shimmer before:bg-linear-to-r before:from-transparent before:via-card/80 before:to-transparent";

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="grid gap-3">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} aria-hidden className={cn("h-16 w-full rounded-xl", shimmerClassName)} />
      ))}
    </div>
  );
}
