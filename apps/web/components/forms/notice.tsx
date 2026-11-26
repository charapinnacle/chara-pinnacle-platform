import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// A white card with a coloured edge and icon: the tone shows in the edge, never as a tinted fill.
const noticeVariants = cva("flex gap-3 rounded-xl border border-s-4 bg-card p-4 text-small leading-relaxed text-foreground", {
  variants: {
    tone: {
      info: "border-s-info-foreground",
      warning: "border-s-brand",
      error: "border-s-danger-foreground",
    },
  },
});

const icons = {
  info: { Icon: Info, className: "text-info-foreground" },
  warning: { Icon: TriangleAlert, className: "text-brand-ink" },
  error: { Icon: CircleAlert, className: "text-danger-foreground" },
} as const;

type NoticeProps = React.ComponentProps<"div"> & VariantProps<typeof noticeVariants>;

// A message that stays on the page. Use a toast for the outcome of an action; give an error role="alert" and any other tone role="status".
export function Notice({ tone, className, children, ...props }: NoticeProps) {
  const icon = icons[tone ?? "info"];
  return (
    <div className={cn(noticeVariants({ tone: tone ?? "info" }), className)} {...props}>
      <icon.Icon aria-hidden className={cn("mt-px size-5 shrink-0", icon.className)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
