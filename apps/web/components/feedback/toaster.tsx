"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import {
  dismiss,
  getToasts,
  noToasts,
  subscribe,
} from "@/components/feedback/toast-store";

const ToastView = dynamic(() => import("@/components/feedback/toast-view"), {
  ssr: false,
});

export function Toaster() {
  const items = useSyncExternalStore(subscribe, getToasts, () => noToasts);

  // Rendering nothing until the first toast keeps Radix (and the inline style it
  // puts on the viewport wrapper, which the nonce CSP would block) out of the
  // server HTML and out of the first-load JavaScript.
  if (items.length === 0) return null;

  return <ToastView items={items} onDismiss={dismiss} />;
}
