import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";

export type ErrorSummaryItem = {
  key: string;
  message: string;
  targetId?: string;
};

type ErrorSummaryProps = {
  ref?: React.Ref<HTMLDivElement>;
  items: readonly ErrorSummaryItem[];
  onSelect: (key: string) => void;
  action?: React.ReactNode;
};

export function ErrorSummary({ ref, items, onSelect, action }: ErrorSummaryProps) {
  if (items.length === 0) return null;
  return (
    <Notice
      ref={ref}
      tone="error"
      role="alert"
      tabIndex={-1}
      className="rounded-lg border-border border-s-4 border-s-destructive bg-card py-3.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="grid gap-1">
        <p className="font-semibold text-destructive">There is a problem</p>
        <ul role="list" className="grid">
          {items.map((item) => (
            <li key={item.key}>
              {item.targetId ? (
                <TextLink
                  tone="destructive"
                  className="block py-2"
                  href={`#${item.targetId}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelect(item.key);
                  }}
                >
                  {item.message}
                </TextLink>
              ) : (
                item.message
              )}
            </li>
          ))}
        </ul>
        {action}
      </div>
    </Notice>
  );
}
