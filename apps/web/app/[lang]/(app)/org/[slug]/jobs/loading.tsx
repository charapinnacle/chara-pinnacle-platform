import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <LoadingSkeleton rows={4} />
    </div>
  );
}
