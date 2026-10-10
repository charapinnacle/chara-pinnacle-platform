import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The type scale and the spacing tokens of globals.css, so that a later size or padding replaces an earlier one.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: { "font-size": [{ text: ["display", "h1", "h2", "h3", "figure", "body", "small", "caption"] }] },
    theme: { spacing: ["card-sm", "card", "card-lg", "page", "section"] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
