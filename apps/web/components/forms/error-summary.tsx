import { CircleAlert } from "lucide-react";
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
};

export function ErrorSummary({ ref, items, onSelect }: ErrorSummaryProps) {
  if (items.length === 0) return null;
  return (
    <Notice
      ref={ref}
      tone="error"
      role="alert"
      tabIndex={-1}
      className="flex gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CircleAlert aria-hidden className="mt-px size-5 shrink-0 text-destructive" />
      <div className="grid min-w-0 gap-1.5">
        <p className="font-semibold text-destructive">There is a problem</p>
        <ul className="grid list-disc gap-1 ps-5 text-foreground marker:text-destructive">
          {items.map((item) => (
            <li key={item.key}>
              {item.targetId ? (
                <TextLink
                  tone="destructive"
                  className="inline-block py-1"
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
      </div>
    </Notice>
  );
}
