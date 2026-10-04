"use client";

import { useEffect, useId, useRef } from "react";

type ModalDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

// The native dialog element gives a modal its focus trap, Escape to close and the return of focus to the control that
// opened it. The content is mounted only while open, so a form starts empty each time.
export function ModalDialog({ open, onClose, title, children }: ModalDialogProps) {
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
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border bg-card p-6 text-foreground shadow-card backdrop:bg-black/50 sm:p-8"
    >
      {open ? (
        <div className="grid gap-5">
          <h2 id={titleId} className="text-xl font-semibold tracking-tight">
            {title}
          </h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
