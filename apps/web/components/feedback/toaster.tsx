"use client";

import dynamic from "next/dynamic";
import { useEffect, useSyncExternalStore } from "react";
import {
  dismiss,
  getToasts,
  noToasts,
  subscribe,
} from "@/components/feedback/toast-store";

const loadToastView = () => import("@/components/feedback/toast-view");
const ToastView = dynamic(loadToastView, { ssr: false });

export function Toaster() {
  const items = useSyncExternalStore(subscribe, getToasts, () => noToasts);

  // The chunk is fetched after hydration, not on first load, so an error toast
  // can still appear when the error is that the network is down.
  useEffect(() => {
    void loadToastView();
  }, []);

  // Rendering nothing until the first toast keeps Radix (and the inline style it
  // puts on the viewport wrapper, which the nonce CSP would block) out of the
  // server HTML and out of the first-load JavaScript.
  if (items.length === 0) return null;

  return <ToastView items={items} onDismiss={dismiss} />;
}
