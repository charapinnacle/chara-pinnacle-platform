import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("keeps the body font size beside a text colour", () => {
    expect(cn("text-body text-muted-foreground")).toBe("text-body text-muted-foreground");
  });

  it("still lets a later font size replace an earlier one", () => {
    expect(cn("text-body", "text-sm")).toBe("text-sm");
  });
});
