import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const bandVariants = cva("relative isolate overflow-hidden", {
  variants: {
    tone: {
      light: "bg-background text-foreground",
      white: "bg-card text-foreground",
      dark: "dark bg-background text-foreground",
    },
  },
});

type BandProps = React.ComponentProps<"section"> & VariantProps<typeof bandVariants>;

export function Band({ tone = "light", className, children, ...props }: BandProps) {
  return (
    <section className={bandVariants({ tone })} {...props}>
      <div data-reveal className={cn("mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24", className)}>
        {children}
      </div>
    </section>
  );
}
