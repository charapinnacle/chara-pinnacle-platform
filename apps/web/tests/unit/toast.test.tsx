import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Toast } from "radix-ui";
import { describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/feedback/toaster";
import ToastView from "@/components/feedback/toast-view";
import {
  dismiss,
  getToasts,
  subscribe,
  toast,
  type ToastItem,
} from "@/components/feedback/toast-store";

describe("toast store", () => {
  it("appends toasts with increasing ids and a default variant", () => {
    toast({ title: "Saved" });
    toast({ title: "Failed", description: "Try again", variant: "error" });
    const [first, second] = getToasts();
    expect(first).toMatchObject({ title: "Saved", variant: "default" });
    expect(second).toMatchObject({
      title: "Failed",
      description: "Try again",
      variant: "error",
    });
    expect(second.id).toBeGreaterThan(first.id);
  });

  it("dismisses only the given id and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    const [first, second] = getToasts();
    dismiss(first.id);
    expect(getToasts().map((item) => item.id)).toEqual([second.id]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    dismiss(second.id);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getToasts()).toEqual([]);
  });

  it("keeps only the three newest toasts so a failing loop cannot fill the screen", () => {
    ["a", "b", "c", "d", "e"].forEach((title) => toast({ title }));
    expect(getToasts().map((item) => item.title)).toEqual(["c", "d", "e"]);
    getToasts().forEach((item) => dismiss(item.id));
  });
});

describe("toaster", () => {
  it("renders nothing on the server so Radix stays out of the HTML", () => {
    toast({ title: "Queued before hydration" });
    expect(renderToStaticMarkup(<Toaster />)).toBe("");
    getToasts().forEach((item) => dismiss(item.id));
  });
});

function findAll(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  const own = node.type === type ? [node] : [];
  return [...own, ...findAll(node.props.children as ReactNode, type)];
}

describe("toast view", () => {
  const items: ToastItem[] = [
    { id: 1, title: "Saved", variant: "default" },
    { id: 2, title: "Failed", description: "Try again", variant: "error" },
  ];
  const onDismiss = vi.fn();
  const roots = findAll(ToastView({ items, onDismiss }), Toast.Root);

  it("announces errors assertively and keeps them until dismissed", () => {
    expect(roots[1].props.type).toBe("foreground");
    expect(roots[1].props.duration).toBe(Infinity);
    expect(String(roots[1].props.className)).toContain("border-destructive");
  });

  it("announces other toasts politely with the default timeout", () => {
    expect(roots[0].props.type).toBe("background");
    expect(roots[0].props.duration).toBeUndefined();
    expect(String(roots[0].props.className)).not.toContain("border-destructive");
  });

  it("dismisses the toast whose Radix root closes", () => {
    const close = roots[1].props.onOpenChange as (open: boolean) => void;
    close(true);
    expect(onDismiss).not.toHaveBeenCalled();
    close(false);
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("labels the dismiss button and renders the title and description", () => {
    const [close] = findAll(roots[1], Toast.Close);
    expect(close.props["aria-label"]).toBe("Dismiss notification");
    expect(findAll(roots[1], Toast.Title)[0].props.children).toBe("Failed");
    expect(findAll(roots[1], Toast.Description)[0].props.children).toBe("Try again");
    expect(findAll(roots[0], Toast.Description)).toEqual([]);
  });
});
