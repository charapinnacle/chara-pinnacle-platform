import type { LucideIcon } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: EmptyStateProps) {
  return (
    <Empty className="animate-rise border border-solid bg-card px-6 py-12">
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
