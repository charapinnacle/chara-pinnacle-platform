import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pageContainerVariants = cva("mx-auto w-full max-w-6xl px-4 sm:px-6", {
  variants: {
    layout: {
      page: "py-10 sm:py-16",
      centered: "flex flex-1 flex-col justify-center py-10 sm:py-16",
    },
  },
});

type PageContainerProps = React.ComponentProps<"div"> & VariantProps<typeof pageContainerVariants>;

export function PageContainer({ layout, className, ...props }: PageContainerProps) {
  return <div className={cn(pageContainerVariants({ layout }), className)} {...props} />;
}
