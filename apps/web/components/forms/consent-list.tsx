import { cn } from "@/lib/utils";

// The consents of a form as a plain list: no fill, a hairline between the rows. An unticked row says so in its own row.
export function ConsentList({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid divide-y divide-border", className)} {...props} />;
}
