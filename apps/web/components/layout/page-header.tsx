import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const headerVariants = cva("", {
  variants: { size: { default: "gap-1", display: "gap-3" } },
  defaultVariants: { size: "default" },
});

const titleVariants = cva("wrap-anywhere", {
  variants: { size: { default: "text-h1", display: "text-display text-balance" } },
  defaultVariants: { size: "default" },
});

const descriptionVariants = cva("text-muted-foreground wrap-anywhere", {
  variants: { size: { default: "text-body", display: "text-lg leading-8" } },
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
// (children), and the page actions at the end of the row. The display size is for marketing and legal pages.
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
  const text = (
    <>
      {breadcrumb}
      <h1 {...titleProps} className={cn(titleVariants({ size }), titleProps?.className)}>
        {title}
      </h1>
      {description ? <p className={descriptionVariants({ size })}>{description}</p> : null}
      {children}
    </>
  );
  if (!actions) return <header className={cn("grid", headerVariants({ size }), className)}>{text}</header>;
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className={cn("grid min-w-0", headerVariants({ size }))}>{text}</div>
      {actions}
    </header>
  );
}
