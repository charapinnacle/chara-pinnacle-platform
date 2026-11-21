"use client";

import { useEffect, useRef } from "react";

// A step's form redirects to the same /onboarding address, which keeps the scroll position, so a new step would open
// halfway down with focus on the page. When the step changes, the page goes back to the top and its heading takes the focus.
export function StepHeading({ title }: { title: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(title);
  useEffect(() => {
    if (shown.current === title) return;
    shown.current = title;
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <h1 ref={heading} tabIndex={-1} className="text-h1 text-balance outline-none">
      {title}
    </h1>
  );
}
