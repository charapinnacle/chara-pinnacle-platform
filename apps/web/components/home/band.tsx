import { PageContainer } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";

// A section of the home page: a hairline above it instead of a box or a coloured band, the content in the page column, and
// the same 80 px (112 px from sm) above and below every section.
export function Band({ className, children, ...props }: React.ComponentProps<"section">) {
  return (
    <section className="border-t" {...props}>
      <PageContainer className={cn("py-20 sm:py-28", className)}>{children}</PageContainer>
    </section>
  );
}
