import { readFileSync } from "node:fs";

export const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

export type Theme = "light" | "dark";
type Oklch = [number, number, number];

function declarations(selector: string): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = new RegExp(`(?:^|\\n)\\s*${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`, "g");
  for (const block of css.matchAll(pattern)) {
    for (const [, name, value] of block[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) found.set(name, value.trim());
  }
  return found;
}

const light = declarations(":root");
const dark = new Map([...light, ...declarations(".dark")]);

export function declared(theme: Theme, name: string): string {
  const value = (theme === "dark" ? dark : light).get(name);
  if (value === undefined) throw new Error(`token --${name} is not declared for the ${theme} theme`);
  const reference = /^var\(--([\w-]+)\)$/.exec(value);
  return reference ? declared(theme, reference[1]) : value;
}

export function token(theme: Theme, name: string): Oklch {
  const match = /^oklch\(([\d.]+)\s+([\d.]+)(?:\s+([\d.]+))?\)$/.exec(declared(theme, name));
  if (!match) throw new Error(`token --${name} is not an oklch colour`);
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

// WCAG relative luminance of an OKLCH colour, through linear sRGB.
export function luminance([lightness, chroma, hue]: Oklch): number {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

export function contrastOf(first: Oklch, second: Oklch): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrast(theme: Theme, foreground: string, background: string): number {
  return contrastOf(token(theme, foreground), token(theme, background));
}
