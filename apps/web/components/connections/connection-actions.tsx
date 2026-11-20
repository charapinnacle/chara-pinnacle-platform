import { Bell } from "lucide-react";
import { ConnectionToggle } from "@/components/connections/connection-toggle";
import { LinkButton } from "@/components/layout/link-button";
import type { ConnectionAccess } from "@/lib/connections/access";
import { loginPath } from "@/lib/routes";

type ConnectionActionsProps = {
  lang: string;
  // Null for a visitor, who is sent to log in and needs no id.
  organizationId: string | null;
  name: string;
  access: ConnectionAccess;
  saved: boolean;
  following: boolean;
  // The page a visitor comes back to after logging in.
  next: string;
  // What Follow says to a visitor: "Follow" on partner profiles and cards (FR-L4 AC9), "Log in to follow" on a company
  // page (FR-K5 AC8 says "Sign up to follow", but sign-up cannot bring the visitor back to the page). Both lead to log in
  // with the way back, and the login page links to sign-up.
  visitorLabel?: "Follow" | "Log in to follow";
};

// Save partner and Follow for one company, as the viewer may use them (FR-L4 roles); nothing for its own members.
export function ConnectionActions({ lang, organizationId, name, access, saved, following, next, visitorLabel = "Follow" }: ConnectionActionsProps) {
  if (access.kind === "none") return null;
  if (access.kind === "visitor") {
    return (
      <LinkButton href={loginPath(lang, next)} variant="secondary" size="default">
        <Bell aria-hidden className="size-4" />
        {visitorLabel}
        <span className="sr-only normal-case"> {name}</span>
      </LinkButton>
    );
  }
  if (!organizationId || (!access.saveFor && !access.follow)) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {access.saveFor ? (
        <ConnectionToggle kind="save" partnerId={organizationId} organizationId={access.saveFor} name={name} active={saved} />
      ) : null}
      {access.follow ? <ConnectionToggle kind="follow" organizationId={organizationId} name={name} active={following} /> : null}
    </div>
  );
}
