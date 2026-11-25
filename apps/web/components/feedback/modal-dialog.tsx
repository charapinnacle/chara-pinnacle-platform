"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";

type ModalDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  closeOnBackdrop?: boolean;
  // A form with fields side by side needs the wider box.
  wide?: boolean;
};

// The native dialog element gives a modal its focus trap, Escape to close and the return of focus to the control that
// opened it. The content is mounted only while open, so a form starts empty each time. A click on the backdrop closes it
// only when asked for, because a dialog that holds typed input must not lose it to a stray click. Escape and the backdrop
// close it through onClose at once: the native close event comes a task later, and a press on the trigger in between
// would find the state still open and be lost. For the same reason a close event that arrives once the dialog is open
// again is ignored. It sits near the top, not centred, so its title and fields stay still when an error summary appears.
// It is never taller than the screen: a long form scrolls inside it, so its Save is always reachable without the page
// behind it moving.
export function ModalDialog({ open, onClose, title, children, closeOnBackdrop = false, wide = false }: ModalDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      onClick={(event) => {
        if (!closeOnBackdrop || event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
        if (outside) onClose();
      }}
      className={cn(
        "mx-auto mt-4 mb-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto overscroll-contain rounded-2xl border bg-card p-card-xl text-foreground shadow-card backdrop:bg-black/50 sm:mt-[min(8vh,4rem)] sm:p-card-2xl sm:max-h-[calc(100dvh-min(8vh,4rem)-1rem)]",
        wide ? "max-w-2xl" : "max-w-md",
      )}
    >
      {open ? (
        <div className="grid gap-5">
          <h2 id={titleId} className="text-h2">
            {title}
          </h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
