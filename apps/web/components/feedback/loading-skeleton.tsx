import { Skeleton } from "@/components/ui/skeleton";

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="grid gap-3">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} aria-hidden className="h-16 w-full" />
      ))}
    </div>
  );
}
