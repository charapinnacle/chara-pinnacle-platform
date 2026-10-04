import { CircleAlert } from "lucide-react";

export type ErrorSummaryItem = {
  key: string;
  message: string;
  targetId?: string;
};

type ErrorSummaryProps = {
  ref?: React.Ref<HTMLDivElement>;
  items: readonly ErrorSummaryItem[];
  onSelect: (key: string) => void;
};

export function ErrorSummary({ ref, items, onSelect }: ErrorSummaryProps) {
  if (items.length === 0) return null;
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive-surface p-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CircleAlert aria-hidden className="mt-px size-5 shrink-0 text-destructive" />
      <div className="grid min-w-0 gap-1.5">
        <p className="font-semibold text-destructive">There is a problem</p>
        <ul className="grid list-disc gap-1 ps-5 leading-relaxed marker:text-destructive">
          {items.map((item) => (
            <li key={item.key}>
              {item.targetId ? (
                <a
                  href={`#${item.targetId}`}
                  className="font-medium text-destructive underline decoration-destructive/40 underline-offset-4 hover:decoration-destructive"
                  onClick={(event) => {
                    event.preventDefault();
                    onSelect(item.key);
                  }}
                >
                  {item.message}
                </a>
              ) : (
                item.message
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
