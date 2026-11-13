import { cn } from "@/lib/utils";

// The consents of a form as one compact block: no fill and no lines between the rows. An unticked row says so in its own row.
export function ConsentList({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-0.5", className)} {...props} />;
}
