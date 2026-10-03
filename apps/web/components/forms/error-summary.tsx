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
      className="rounded-lg border border-destructive p-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <p className="font-medium text-destructive">There is a problem</p>
      <ul className="mt-2 list-disc ps-5">
        {items.map((item) => (
          <li key={item.key}>
            {item.targetId ? (
              <a
                href={`#${item.targetId}`}
                className="underline underline-offset-4"
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
  );
}
