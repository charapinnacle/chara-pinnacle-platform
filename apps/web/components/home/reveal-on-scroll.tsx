"use client";

import { useEffect } from "react";

// Lets the bands below the first screen rise in as they enter it. It only ever hides what is still out of sight, after the
// page has been painted, so the page is complete without JavaScript, nothing moves that is already on screen, and the
// document does not change size. Under reduced motion it does nothing at all.
export function RevealOnScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          if (!isIntersecting) continue;
          target.setAttribute("data-reveal", "shown");
          observer.unobserve(target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const element of document.querySelectorAll("[data-reveal]")) {
      if (element.getBoundingClientRect().top < window.innerHeight) continue;
      element.setAttribute("data-reveal", "pending");
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return null;
}
