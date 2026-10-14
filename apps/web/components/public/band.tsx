import { PageContainer } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";

export function Band({ className, children, ...props }: React.ComponentProps<"section">) {
  return (
    <section className="border-t" {...props}>
      <PageContainer className={cn("py-20 sm:py-28 lg:py-32", className)}>{children}</PageContainer>
    </section>
  );
}
