"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const controlClassName =
  "inline-flex size-11 items-center justify-center rounded-full border bg-card transition-colors duration-150 hover:border-input";

// A vacancy opened from the results: a modal dialog over the list (the page behind is inert, focus stays inside, Escape
// closes it), full screen on a phone. The address carries the vacancy (job=), so Back closes it and a shared link opens
// it again; closing goes back to the search without it and keeps the list where it was.
export function VacancyDialog({ labelledBy, closeHref, children }: { labelledBy: string; closeHref: string; children: React.ReactNode }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, []);

  // A press on the backdrop lands on the dialog itself, outside its box.
  function onClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) event.currentTarget.close();
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={labelledBy}
      onClose={() => router.replace(closeHref, { scroll: false })}
      onClick={onClick}
      className="m-auto h-dvh max-h-none w-full max-w-none overflow-y-auto bg-transparent p-0 text-foreground outline-none backdrop:bg-inverse/40 sm:h-auto sm:max-h-[90dvh] sm:max-w-3xl sm:rounded-3xl"
    >
      <div className="relative min-h-full bg-card sm:min-h-0 sm:rounded-3xl">
        <form method="dialog" className="absolute end-4 top-4 z-10">
          <button type="submit" className={controlClassName}>
            <X aria-hidden className="size-5" />
            <span className="sr-only">Close</span>
          </button>
        </form>
        {children}
      </div>
    </dialog>
  );
}
