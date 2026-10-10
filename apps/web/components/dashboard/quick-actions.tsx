import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/layout/card";
import { LinkButton } from "@/components/layout/link-button";

type QuickAction = { href: string; label: string; icon: LucideIcon };

// The pages a person goes to most from the dashboard, as buttons.
export function QuickActions({ actions }: { actions: readonly QuickAction[] }) {
  return (
    <Card as="section" aria-labelledby="quick-actions-heading" padding="lg" elevated className="content-start gap-4">
      <h2 id="quick-actions-heading" className="text-h2">
        Quick actions
      </h2>
      <ul className="grid gap-2">
        {actions.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <LinkButton href={href} variant="secondary" size="lg" className="w-full justify-start gap-3 px-4 text-small">
              <Icon aria-hidden className="size-4 text-muted-foreground" strokeWidth={1.75} />
              {label}
            </LinkButton>
          </li>
        ))}
      </ul>
    </Card>
  );
}
