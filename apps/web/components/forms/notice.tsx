import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const noticeVariants = cva("rounded-xl border p-4 text-sm leading-relaxed", {
  variants: {
    tone: {
      info: "border-primary/20 bg-accent text-accent-foreground",
      error: "border-destructive/30 bg-destructive-surface text-destructive",
    },
  },
});

type NoticeProps = React.ComponentProps<"div"> & VariantProps<typeof noticeVariants>;

export function Notice({ tone, className, ...props }: NoticeProps) {
  return <div className={cn(noticeVariants({ tone }), className)} {...props} />;
}
