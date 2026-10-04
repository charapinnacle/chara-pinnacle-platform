import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type AuthCardProps = {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  children?: React.ReactNode;
  footer?: React.ReactNode;
};

export const cardDividerClassName = "border-t pt-6";

export function AuthCard({ title, description, icon: Icon, children, footer }: AuthCardProps) {
  return (
    <div className="mx-auto grid w-full max-w-md gap-6 rounded-2xl border bg-card p-6 shadow-card sm:p-8">
      {title || Icon ? (
        <div className={cn("grid gap-2", Icon && "justify-items-center text-center")}>
          {Icon ? (
            <span
              aria-hidden
              className="mb-3 flex size-14 items-center justify-center rounded-full bg-accent text-primary"
            >
              <Icon className="size-7" />
            </span>
          ) : null}
          {title ? (
            <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem] sm:leading-9">
              {title}
            </h1>
          ) : null}
          {description ? (
            <p className={cn("text-body leading-relaxed text-muted-foreground", Icon ? "text-balance" : "text-pretty")}>
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
      {footer ? <div className={cn(cardDividerClassName, "text-body text-muted-foreground")}>{footer}</div> : null}
    </div>
  );
}
