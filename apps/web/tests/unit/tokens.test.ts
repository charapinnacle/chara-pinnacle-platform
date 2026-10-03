import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const rootBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

function token(name: string): [number, number, number] {
  const match = new RegExp(
    `--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)(?:\\s+([\\d.]+))?\\)`,
  ).exec(rootBlock);
  if (!match) throw new Error(`token --${name} is missing or not an oklch colour`);
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function luminance([lightness, chroma, hue]: [number, number, number]) {
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

function contrast(foreground: string, background: string) {
  const [lighter, darker] = [
    luminance(token(foreground)),
    luminance(token(background)),
  ].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("design tokens meet WCAG 2.2 AA contrast (NFR-U1)", () => {
  it.each([
    ["foreground", "background"],
    ["primary-foreground", "primary"],
    ["secondary-foreground", "secondary"],
    ["accent-foreground", "accent"],
    ["muted-foreground", "background"],
    ["muted-foreground", "muted"],
    ["destructive", "background"],
    ["destructive", "muted"],
  ])("text %s on %s is at least 4.5:1", (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["ring", "background"],
    ["input", "background"],
  ])("component boundary %s against %s is at least 3:1", (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3);
  });

  it("computes the known black on white ratio", () => {
    expect(contrast("foreground", "background")).toBeGreaterThan(18);
  });
});
