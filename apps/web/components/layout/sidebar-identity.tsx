import { cn } from "@/lib/utils";

type SidebarIdentityProps = { title: string; detail?: string; className?: string };

// Who or what the signed-in area is about, at the foot of the sidebar: an organisation and the role in it, or an account.
export function SidebarIdentity({ title, detail, className }: SidebarIdentityProps) {
  return (
    <span className={cn("grid min-w-0 leading-tight", className)}>
      <span className="truncate text-small font-medium text-foreground">{title}</span>
      {detail ? <span className="truncate text-caption text-muted-foreground">{detail}</span> : null}
    </span>
  );
}
