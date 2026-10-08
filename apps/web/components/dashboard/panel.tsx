import { Suspense } from "react";
import { CardError } from "@/components/dashboard/card-error";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";

type PanelProps<T> = {
  promise: Promise<T>;
  errorTitle: string;
  // A quiet part has no skeleton and shows nothing when its read fails: another part of the page reports the failure.
  quiet?: true;
  children: (value: T) => React.ReactNode;
};

async function Resolved<T>({ promise, errorTitle, quiet, children }: PanelProps<T>) {
  let value: T;
  try {
    value = await promise;
  } catch {
    return quiet ? null : <CardError title={errorTitle} />;
  }
  return children(value);
}

// One part of the dashboard: a skeleton until its read is done, then its content, or an error with Try again in its place.
// Each part waits for its own read, so a slow or failing one does not hold back the others.
export function Panel<T>(props: PanelProps<T>) {
  return (
    <Suspense fallback={props.quiet ? null : <LoadingSkeleton rows={1} />}>
      <Resolved {...props} />
    </Suspense>
  );
}
