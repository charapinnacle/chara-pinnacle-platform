"use client";

import { useEffect } from "react";

// Moves focus to the element with the id once the page has loaded: after a decision the reviewer lands on the queue with
// focus on the next partner (FR-J4 AC11). Nothing happens when the element is absent.
export function FocusOnMount({ targetId }: { targetId: string }) {
  useEffect(() => {
    document.getElementById(targetId)?.focus();
  }, [targetId]);
  return null;
}
