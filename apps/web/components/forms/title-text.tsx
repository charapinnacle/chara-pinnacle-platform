import { Children, type ReactNode } from "react";

// Buttons and header links show their sentence-case labels in Title Case through CSS capitalize; the short words of a title
// stay lower case after the first word (the client's choice, 17 Nov 2026), so "Submit a candidate" reads "Submit a
// Candidate". A unit after a number stays as written too, so a countdown reads "Resend in 54 s", not "Resend In 54 S". The
// written text is unchanged for screen readers and tests. A label next to an icon or a spinner is one string among the
// children and is treated the same.
const SMALL_WORDS = new Set(["a", "an", "the", "and", "but", "or", "nor", "of", "to", "in", "on", "at", "by", "for", "as", "per", "via"]);
const UNITS = new Set(["s"]);

export function titleText(children: ReactNode): ReactNode {
  if (Array.isArray(children)) return Children.map(children, (child) => titleText(child));
  if (typeof children !== "string") return children;
  const parts = children.split(/(\s+)/);
  const small = (part: string, index: number) =>
    index > 0 && (SMALL_WORDS.has(part.toLowerCase()) || (UNITS.has(part) && /^\d+$/.test(parts[index - 2] ?? "")));
  if (!parts.some(small)) return children;
  // One outer span keeps the words a single flex item, so a button's gap does not space them apart.
  return (
    <span>
      {parts.map((part, index) =>
        small(part, index) ? (
          <span key={index} className="normal-case">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  );
}
