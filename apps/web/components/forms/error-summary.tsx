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
      className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="grid gap-1.5">
        <p className="font-semibold text-destructive">There is a problem</p>
        <ul className="grid list-disc ps-5 marker:text-destructive">
          {items.map((item) => (
            <li key={item.key}>
              {item.targetId ? (
                <TextLink
                  tone="destructive"
                  className="block py-2.5"
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
