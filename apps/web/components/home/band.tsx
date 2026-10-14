import { PageContainer } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";

// A section of the home and For employers pages: a hairline above it instead of a box or a coloured band, the content in the
// page column, and the same 80 px (112 px from sm, 128 px from lg) above and below every section.
export function Band({ className, children, ...props }: React.ComponentProps<"section">) {
  return (
    <section className="border-t" {...props}>
      <PageContainer className={cn("py-20 sm:py-28 lg:py-32", className)}>{children}</PageContainer>
    </section>
  );
}
