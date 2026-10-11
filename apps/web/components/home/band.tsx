import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const bandVariants = cva("relative isolate overflow-hidden", {
  variants: {
    tone: {
      light: "bg-background text-foreground",
      tint: "bg-muted text-foreground",
      dark: "dark bg-background text-foreground",
    },
  },
});

type BandProps = React.ComponentProps<"section"> & VariantProps<typeof bandVariants> & { textured?: boolean };

export function Band({ tone = "light", textured = false, className, children, ...props }: BandProps) {
  return (
    <section className={bandVariants({ tone })} {...props}>
      {textured ? <div aria-hidden className="band-texture absolute inset-0 -z-10" /> : null}
      <div data-reveal className={cn("mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28", className)}>
        {children}
      </div>
    </section>
  );
}
