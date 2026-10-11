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
  return (
    <Empty className={cn("animate-rise px-6 py-12", !flat && "border border-solid bg-card")}>
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon" className="size-11 rounded-xl bg-accent text-brand-ink [&_svg:not([class*='size-'])]:size-5">
            <Icon aria-hidden />
          </EmptyMedia>
        ) : null}
        <EmptyTitle role="heading" aria-level={2} className="text-h3">
          {title}
        </EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  );
}
