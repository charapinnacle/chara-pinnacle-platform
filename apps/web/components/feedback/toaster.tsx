"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

export type ToastItem = {
  id: number;
  title: string;
  description?: string;
  variant: "default" | "error";
};

type ToastInput = Omit<ToastItem, "id" | "variant"> & {
  variant?: ToastItem["variant"];
};

const ToastView = dynamic(() => import("@/components/feedback/toast-view"), {
  ssr: false,
});

const listeners = new Set<() => void>();
const noToasts: ToastItem[] = [];
let toasts = noToasts;
let nextId = 0;

function publish(next: ToastItem[]) {
  toasts = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function toast({ variant = "default", ...input }: ToastInput) {
  publish([...toasts, { id: nextId++, variant, ...input }]);
}

function dismiss(id: number) {
  publish(toasts.filter((item) => item.id !== id));
}

export function Toaster() {
  const items = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => noToasts,
  );

  // Rendering nothing until the first toast keeps Radix (and the inline style it
  // puts on the viewport wrapper, which the nonce CSP would block) out of the
  // server HTML and out of the first-load JavaScript.
  if (items.length === 0) return null;

  return <ToastView items={items} onDismiss={dismiss} />;
}
