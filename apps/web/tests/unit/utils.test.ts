import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("keeps the body font size beside a text colour", () => {
    expect(cn("text-body text-muted-foreground")).toBe("text-body text-muted-foreground");
  });

  it("still lets a later font size replace an earlier one", () => {
    expect(cn("text-body", "text-sm")).toBe("text-sm");
  });

  it.each(["display", "h1", "h2", "h3", "small", "caption"])("keeps the %s size beside a text colour", (size) => {
    expect(cn(`text-${size} text-muted-foreground`)).toBe(`text-${size} text-muted-foreground`);
  });

  it("lets a later size of the scale replace an earlier one", () => {
    expect(cn("text-h2", "text-small")).toBe("text-small");
  });

  it("lets a later padding replace a card padding token", () => {
    expect(cn("p-card", "p-6")).toBe("p-6");
    expect(cn("p-6", "p-card-lg")).toBe("p-card-lg");
    expect(cn("gap-page", "gap-2")).toBe("gap-2");
  });
});
