import { describe, expect, it } from "vitest";
import { contrast, contrastOf, css, declared, type Theme } from "./support/tokens";

const themes: Theme[] = ["light", "dark"];
const STATUSES = ["success", "warning", "danger", "info", "neutral"] as const;

describe.each(themes)("design tokens meet WCAG 2.2 AA contrast in the %s theme (NFR-U1)", (theme) => {
  it.each([
    ["foreground", "background"],
    ["foreground", "card"],
    ["foreground", "muted"],
    ["foreground", "accent"],
    ["foreground", "destructive-surface"],
    ["primary-foreground", "primary"],
    ["primary-foreground", "primary-hover"],
    ["primary-foreground", "primary-active"],
    ["secondary-foreground", "secondary"],
    ["secondary-foreground", "card"],
    ["secondary-foreground", "muted"],
    ["secondary-foreground", "background"],
    ["accent-foreground", "accent"],
    ["muted-foreground", "background"],
    ["muted-foreground", "card"],
    ["muted-foreground", "muted"],
    ["muted-foreground", "destructive-surface"],
    ["muted-foreground", "accent"],
    ["primary", "background"],
    ["primary", "card"],
    ["primary", "muted"],
    ["primary", "accent"],
    ["primary", "destructive-surface"],
    ["destructive", "background"],
    ["destructive", "card"],
    ["destructive", "muted"],
    ["destructive", "destructive-surface"],
    ["destructive-foreground", "destructive"],
    ["destructive-foreground", "destructive-hover"],
    ["destructive-foreground", "destructive-active"],
    ["brand-ink", "background"],
    ["brand-ink", "card"],
    ["brand-ink", "muted"],
    ["brand-ink", "accent"],
    ["accent-foreground", "background"],
    ["accent-foreground", "card"],
    ["inverse-foreground", "inverse"],
    ["inverse-muted", "inverse"],
    ["brand", "inverse"],
    ["inverse", "brand"],
    ["inverse", "brand-highlight"],
    ...STATUSES.flatMap((status) =>
      ["background", "card", "muted", `${status}-background`].map((surface) => [`${status}-foreground`, surface]),
    ),
    ...STATUSES.flatMap((status) => [
      ["foreground", `${status}-background`],
      ["muted-foreground", `${status}-background`],
    ]),
  ])("text %s on %s is at least 4.5:1", (foreground, background) => {
    expect(contrast(theme, foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["ring", "background"],
    ["ring", "card"],
    ["ring", "muted"],
    ["ring", "accent"],
    ["ring", "destructive-surface"],
    ["input", "background"],
    ["input", "card"],
    ["input", "muted"],
    ["brand", "inverse"],
  ])("component boundary %s against %s is at least 3:1", (foreground, background) => {
    expect(contrast(theme, foreground, background)).toBeGreaterThanOrEqual(3);
  });

  it.each(STATUSES)("the %s border stays visible against its own background and the page", (status) => {
    expect(contrast(theme, `${status}-border`, `${status}-background`)).toBeGreaterThanOrEqual(1.5);
    expect(contrast(theme, `${status}-border`, "card")).toBeGreaterThanOrEqual(1.5);
  });
});

describe("the contrast helper", () => {
  it("computes the known ratio of black on white and of a colour on itself", () => {
    expect(contrastOf([0, 0, 0], [1, 0, 0])).toBeCloseTo(21, 1);
    expect(contrastOf([0.5, 0.1, 200], [0.5, 0.1, 200])).toBeCloseTo(1, 5);
  });

  it("reads the tokens of both themes and follows var() references", () => {
    expect(declared("light", "danger-foreground")).toBe(declared("light", "destructive"));
    expect(declared("dark", "danger-foreground")).toBe(declared("dark", "destructive"));
    expect(declared("dark", "background")).not.toBe(declared("light", "background"));
    expect(contrast("light", "foreground", "background")).toBeGreaterThan(18);
  });

  it("fails for a token that does not exist, so a typo in the list above cannot pass", () => {
    expect(() => contrast("light", "foreground", "no-such-token")).toThrow(/not declared/);
  });
});

describe("the type scale and spacing tokens (DS-02)", () => {
  it.each(["hero", "display", "h1", "h2", "h3", "body", "small", "caption", "eyebrow"])("declares the %s size", (size) => {
    expect(css).toMatch(new RegExp(`--text-${size}:\\s*[\\d.]+rem;`));
  });

  it("steps display and h1 up from the sm breakpoint", () => {
    expect(css).toMatch(/@media \(min-width: 40rem\)\s*\{\s*:root\s*\{[^}]*--text-display: 3rem;[^}]*--text-h1: 2rem;/);
  });

  it("steps the hero headline up from the sm and the lg breakpoint", () => {
    expect(css).toMatch(/@media \(min-width: 40rem\)\s*\{\s*:root\s*\{[^}]*--text-hero: 3.5rem;/);
    expect(css).toMatch(/@media \(min-width: 64rem\)\s*\{\s*:root\s*\{\s*--text-hero: 4rem;/);
  });

  it("draws the brand gradient from the highlight to the solid gold, the only two golds it uses", () => {
    expect(css).toMatch(/@utility bg-brand-gradient\s*\{\s*background-image: linear-gradient\(135deg, var\(--brand-highlight\), var\(--brand\)\);/);
  });

  it.each(["card-sm", "card", "card-lg", "page", "section"])("declares the %s spacing", (name) => {
    expect(css).toMatch(new RegExp(`--spacing-${name}:\\s*[\\d.]+rem;`));
  });
});

describe("visible focus (NFR-U1)", () => {
  it("draws the focus outline outside any cascade layer so primitives cannot remove it", () => {
    const layerStart = css.indexOf("@layer base");
    let depth = 0;
    let layerEnd = layerStart;
    for (let i = css.indexOf("{", layerStart); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        layerEnd = i + 1;
        break;
      }
    }
    const unlayered = css.slice(0, layerStart) + css.slice(layerEnd);
    const rule = /([^{}]*:focus-visible)\s*\{([^}]*)\}/.exec(unlayered);
    expect(rule?.[1]).toMatch(/input/);
    expect(rule?.[1]).toMatch(/textarea/);
    expect(rule?.[1]).toMatch(/button/);
    expect(rule?.[2]).toMatch(/outline:\s*var\(--focus-ring\)/);
    expect(declared("light", "focus-ring")).toBe("2px solid var(--ring)");
  });

  it("draws it in gold on the near-black surfaces, where the bronze ring is under 3:1", () => {
    expect(contrast("light", "ring", "inverse")).toBeLessThan(3);
    expect(css).toMatch(/:where\(\.bg-inverse\)\s*\{\s*--ring: var\(--brand\);\s*--focus-ring: 2px solid var\(--ring\);\s*\}/);
  });
});
