import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const noticeVariants = cva("rounded-xl border p-4 text-sm leading-relaxed", {
  variants: {
    tone: {
      info: "border-primary/20 bg-accent text-accent-foreground",
      error: "flex gap-3 border-destructive/30 bg-destructive-surface text-foreground",
    },
  },
});

type NoticeProps = React.ComponentProps<"div"> & VariantProps<typeof noticeVariants>;

export function Notice({ tone, className, children, ...props }: NoticeProps) {
  return (
    <div className={cn(noticeVariants({ tone }), className)} {...props}>
      {tone === "error" ? (
        <>
          <CircleAlert aria-hidden className="mt-px size-5 shrink-0 text-destructive" />
          <div className="min-w-0">{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}
