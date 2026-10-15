"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

// The panel beside the list is shown from this width (Tailwind lg).
const PANEL_QUERY = "(min-width: 64rem)";

type ResultLinkProps = Omit<React.ComponentProps<typeof Link>, "href"> & { href: string; panelHref: string };

// The title of a result: the vacancy page, which is where a phone and a browser without JavaScript go. Where the panel is
// shown, a plain press opens the vacancy there instead and keeps the list where it is; a press with a modifier key still
// opens the page in a new tab or window. While the panel loads the link is marked pending, which the list styles.
export function ResultLink({ href, panelHref, onClick, ...props }: ResultLinkProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Link
      href={href}
      data-pending={pending || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (!window.matchMedia(PANEL_QUERY).matches) return;
        event.preventDefault();
        startTransition(() => router.push(panelHref, { scroll: false }));
      }}
      {...props}
    />
  );
}
