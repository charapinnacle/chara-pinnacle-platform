import { Search } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadError } from "@/components/feedback/load-error";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { FormButton } from "@/components/forms/form-button";

type ResultsPanelProps = {
  status: "idle" | "loading" | "error" | "ready";
  empty: string;
  failure: string;
  hasRows: boolean;
  page: number;
  hasNext: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onRetry: () => void;
  children: React.ReactNode;
};

export function ResultsPanel({ status, empty, failure, hasRows, page, hasNext, onNext, onPrevious, onRetry, children }: ResultsPanelProps) {
  return (
    <div aria-busy={status === "loading"} className="grid gap-4">
      {status === "loading" ? <LoadingSkeleton rows={5} /> : null}
      {status === "error" ? <LoadError title={failure} retry={onRetry} /> : null}
      {status === "ready" && !hasRows ? <EmptyState icon={Search} title={empty} /> : null}
      {status === "ready" && hasRows ? (
        <>
          {children}
          <nav aria-label="Pages" className="flex items-center justify-between gap-3">
            <FormButton type="button" variant="secondary" disabled={page === 1} onClick={onPrevious}>
              Previous
            </FormButton>
            <span className="text-sm text-muted-foreground">Page {page}</span>
            <FormButton type="button" variant="secondary" disabled={!hasNext} onClick={onNext}>
              Next
            </FormButton>
          </nav>
        </>
      ) : null}
    </div>
  );
}
