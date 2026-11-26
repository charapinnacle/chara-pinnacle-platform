import type { LucideIcon } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  // Inside a card the empty state has no border of its own: no card inside a card.
  flat?: boolean;
  children?: React.ReactNode;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  flat,
  children,
}: EmptyStateProps) {
  // Compact: the words, then the action under them on the left (where no toast covers it), never a tall centred box.
  return (
    <Empty
      className={cn(
        "animate-rise flex-col items-start justify-start gap-4 p-5 text-start",
        !flat && "border border-solid bg-card",
        flat && "p-0",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <EmptyMedia variant="icon" className="mb-0 size-10 shrink-0 rounded-xl bg-accent text-brand-ink [&_svg:not([class*='size-'])]:size-5">
            <Icon aria-hidden />
          </EmptyMedia>
        ) : null}
        <EmptyHeader className="max-w-prose items-start gap-1">
          <EmptyTitle role="heading" aria-level={2} className="text-body font-semibold">
            {title}
          </EmptyTitle>
          {description ? <EmptyDescription className="text-small">{description}</EmptyDescription> : null}
        </EmptyHeader>
      </div>
      {children ? <EmptyContent className={cn("w-auto max-w-none flex-row flex-wrap items-center gap-x-6 gap-y-3", Icon && "sm:ps-13")}>{children}</EmptyContent> : null}
    </Empty>
  );
}
