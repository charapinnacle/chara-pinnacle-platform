import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { AuthCard } from "@/components/layout/auth-card";

export default function Loading() {
  return (
    <AuthCard>
      <LoadingSkeleton rows={3} />
    </AuthCard>
  );
}
