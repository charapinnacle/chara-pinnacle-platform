import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const noticeVariants = cva("rounded-xl border p-4 text-small leading-relaxed", {
  variants: {
    tone: {
      info: "border-info-border bg-info-background text-info-foreground",
      warning: "flex gap-3 border-warning-border bg-warning-background text-foreground",
      error: "flex gap-3 border-danger-border bg-danger-background text-foreground",
    },
  },
});

const icons = {
  warning: { Icon: TriangleAlert, className: "text-warning-foreground" },
  error: { Icon: CircleAlert, className: "text-danger-foreground" },
} as const;

type NoticeProps = React.ComponentProps<"div"> & VariantProps<typeof noticeVariants>;

// A message that stays on the page. Use a toast for the outcome of an action; give an error role="alert" and any other tone role="status".
export function Notice({ tone, className, children, ...props }: NoticeProps) {
  const icon = tone && tone !== "info" ? icons[tone] : null;
  return (
    <div className={cn(noticeVariants({ tone }), className)} {...props}>
      {icon ? (
        <>
          <icon.Icon aria-hidden className={cn("mt-px size-5 shrink-0", icon.className)} />
          <div className="min-w-0">{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}
