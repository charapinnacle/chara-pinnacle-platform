"use client";

import { useEffect } from "react";

// Moves the focus to the element whose id the address names after #, once the page is shown: a change notice links to
// the changes of the invitation, and the browser scrolls there without moving the focus, so keyboard and screen-reader
// users would start at the top (WCAG 2.4.3). The target takes tabIndex -1.
export function FocusOnHash({ targetId }: { targetId: string }) {
  useEffect(() => {
    if (window.location.hash === `#${targetId}`) document.getElementById(targetId)?.focus();
  }, [targetId]);
  return null;
}
