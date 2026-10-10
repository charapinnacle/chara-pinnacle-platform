export type ToastItem = {
  id: number;
  title: string;
  description?: string;
  variant: "default" | "error";
};

type ToastInput = Omit<ToastItem, "id" | "variant"> & {
  variant?: ToastItem["variant"];
};

const MAX_TOASTS = 3;

const listeners = new Set<() => void>();
export const noToasts: ToastItem[] = [];
let toasts = noToasts;
let nextId = 0;

function publish(next: ToastItem[]) {
  toasts = next;
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts() {
  return toasts;
}

export function toast({ variant = "default", ...input }: ToastInput) {
  publish([...toasts, { id: nextId++, variant, ...input }].slice(-MAX_TOASTS));
}

export function toastError(title: string, description?: string) {
  toast({ variant: "error", title, description });
}

// A server call that could not be made at all: the same words everywhere, because the cause is always the connection.
export function toastNetworkError(title: string) {
  toastError(title, "Check your connection and try again.");
}

export function dismiss(id: number) {
  publish(toasts.filter((item) => item.id !== id));
}
