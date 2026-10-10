import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type SidebarIdentityProps = { icon: LucideIcon; title: string; detail?: string; className?: string };

// Who or what the signed-in area is about, at the foot of the sidebar: an organisation and the role in it, or an account.
export function SidebarIdentity({ icon: Icon, title, detail, className }: SidebarIdentityProps) {
  return (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground">
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <span className="grid min-w-0 leading-tight">
        <span className="truncate text-small font-medium text-foreground">{title}</span>
        {detail ? <span className="truncate text-caption text-muted-foreground">{detail}</span> : null}
      </span>
    </span>
  );
}
