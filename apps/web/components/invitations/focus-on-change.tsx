"use client";

import { useEffect, useRef } from "react";

// Moves the focus to the element targetId once value changes after the first render: the page is drawn again after an
// answer or a withdrawal, and the control that had the focus is gone with the old status (WCAG 2.4.3). The target takes
// tabIndex -1.
export function FocusOnChange({ targetId, value }: { targetId: string; value: string }) {
  const first = useRef(value);
  useEffect(() => {
    if (value !== first.current) document.getElementById(targetId)?.focus();
  }, [targetId, value]);
  return null;
}
