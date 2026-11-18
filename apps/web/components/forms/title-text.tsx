import type { ReactNode } from "react";

// Buttons and header links show their sentence-case labels in Title Case through CSS capitalize; the short words of a title
// stay lower case after the first word (the client's choice, 17 Nov 2026), so "Submit a candidate" reads "Submit a
// Candidate". The written text is unchanged for screen readers and tests.
const SMALL_WORDS = new Set(["a", "an", "the", "and", "but", "or", "nor", "of", "to", "in", "on", "at", "by", "for", "as", "per", "via"]);

export function titleText(children: ReactNode): ReactNode {
  if (typeof children !== "string") return children;
  const parts = children.split(/(\s+)/);
  const small = (part: string, index: number) => index > 0 && SMALL_WORDS.has(part.toLowerCase());
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
