import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The type scale and the spacing tokens of globals.css, so that a later size or padding replaces an earlier one.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: { "font-size": [{ text: ["hero", "display", "h1", "h2", "h3", "lead", "figure", "body", "small", "caption", "eyebrow"] }] },
    theme: { spacing: ["card-sm", "card", "card-lg", "page", "section"] },
  },
});

// The length the database counts (char_length): a character outside the basic plane is one, not two as in string.length.
export const characters = (value: string) => Array.from(value).length;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
