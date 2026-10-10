"use client";

import { X } from "lucide-react";
import { Toast } from "radix-ui";
import { cva } from "class-variance-authority";
import type { ToastItem } from "@/components/feedback/toast-store";

const toastVariants = cva(
  "pointer-events-auto relative flex w-full items-start gap-3 rounded-xl border bg-card p-4 pe-12 text-foreground shadow-card data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4",
  {
    variants: {
      variant: {
        default: "",
        error: "border-destructive",
      },
    },
  },
);

export default function ToastView({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <Toast.Provider label="Notification" swipeDirection="down">
      {items.map(({ id, title, description, variant }) => (
        <Toast.Root
          key={id}
          type={variant === "error" ? "foreground" : "background"}
          duration={variant === "error" ? Infinity : undefined}
          onOpenChange={(open) => {
            if (!open) onDismiss(id);
          }}
          className={toastVariants({ variant })}
        >
          <div className="grid gap-1">
            <Toast.Title className="text-small font-medium">{title}</Toast.Title>
            {description ? (
              <Toast.Description className="text-small text-muted-foreground">
                {description}
              </Toast.Description>
            ) : null}
          </div>
          <Toast.Close
            aria-label="Dismiss notification"
            className="absolute end-1 top-1 rounded-md p-3.5 text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </Toast.Close>
        </Toast.Root>
      ))}
      <Toast.Viewport className="fixed inset-x-0 bottom-0 z-50 m-0 flex max-h-dvh list-none flex-col gap-2 p-4 outline-none sm:inset-x-auto sm:end-0 sm:w-96" />
    </Toast.Provider>
  );
}
