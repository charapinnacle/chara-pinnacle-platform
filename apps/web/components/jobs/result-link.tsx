"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

type ResultLinkProps = Omit<React.ComponentProps<typeof Link>, "href"> & { href: string; dialogHref: string };

// The title of a result: the vacancy page, which is where a browser without JavaScript goes. With JavaScript a plain press
// opens the vacancy in a dialog over the list instead and keeps the list where it is; a press with a modifier key still
// opens the page in a new tab or window. While the dialog loads the link is marked pending, which the row styles.
export function ResultLink({ href, dialogHref, onClick, ...props }: ResultLinkProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Link
      href={href}
      data-pending={pending || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        startTransition(() => router.push(dialogHref, { scroll: false }));
      }}
      {...props}
    />
  );
}
