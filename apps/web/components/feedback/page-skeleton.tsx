import { shimmerClassName } from "@/components/feedback/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The shape of a page of the signed-in area while it loads: the title, a row of cards and a wide panel, in the width the
// page will have, so nothing jumps when it arrives (UX-11).
export function PageSkeleton() {
  const block = (className: string) => <Skeleton aria-hidden className={cn("rounded-xl", shimmerClassName, className)} />;
  return (
    <div role="status" aria-busy="true" className="grid gap-section">
      <span className="sr-only">Loading</span>
      <div className="grid gap-3">
        {block("h-9 w-56")}
        {block("h-5 w-80 max-w-full")}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {block("h-32")}
        {block("h-32")}
        {block("h-32 max-lg:hidden")}
      </div>
      {block("h-64")}
    </div>
  );
}
