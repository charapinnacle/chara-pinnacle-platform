import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The type scale, the spacing and the radius tokens of globals.css, so that a later size, padding or radius replaces an earlier one.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: { "font-size": [{ text: ["hero", "section", "display", "h1", "h2", "h3", "lead", "figure", "body", "small", "caption", "eyebrow"] }] },
    theme: {
      spacing: ["card-sm", "card", "card-lg", "card-xl", "card-2xl", "card-3xl", "page", "section"],
      radius: ["control", "card"],
    },
  },
});

// The length the database counts (char_length): a character outside the basic plane is one, not two as in string.length.
export const characters = (value: string) => Array.from(value).length;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
