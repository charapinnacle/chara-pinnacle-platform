import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const titleVariants = cva("", {
  variants: {
    size: {
      default: "text-h1",
      display: "text-display text-balance",
    },
  },
  defaultVariants: { size: "default" },
});

type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  size?: "default" | "display";
  titleProps?: Omit<React.ComponentProps<"h1">, "children">;
  className?: string;
  children?: React.ReactNode;
};

// The h1 of a page with what belongs next to it: a breadcrumb above, a description and any further line under it
// (children), and the page actions at the end of the row.
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  size,
  titleProps,
  className,
  children,
}: PageHeaderProps) {
  return (
    <header className={cn(actions ? "flex flex-wrap items-end justify-between gap-4" : undefined, className)}>
      <div className="grid min-w-0 gap-1">
        {breadcrumb}
        <h1 {...titleProps} className={cn(titleVariants({ size }), titleProps?.className)}>
          {title}
        </h1>
        {description ? <p className="text-body text-muted-foreground">{description}</p> : null}
        {children}
      </div>
      {actions}
    </header>
  );
}
