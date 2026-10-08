"use client";

import { useEffect, useId, useRef } from "react";

type ModalDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  closeOnBackdrop?: boolean;
};

// The native dialog element gives a modal its focus trap, Escape to close and the return of focus to the control that
// opened it. The content is mounted only while open, so a form starts empty each time. A click on the backdrop closes it
// only when asked for, because a dialog that holds typed input must not lose it to a stray click.
export function ModalDialog({ open, onClose, title, children, closeOnBackdrop = false }: ModalDialogProps) {
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
      onClick={(event) => {
        if (!closeOnBackdrop || event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
        if (outside) event.currentTarget.close();
      }}
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
