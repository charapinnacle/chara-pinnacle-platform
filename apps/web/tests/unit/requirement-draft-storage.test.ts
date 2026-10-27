import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRequirementDrafts,
  readRequirementDraft,
  requirementDraftKey,
  writeRequirementDraft,
} from "@/lib/requirements/draft-storage";
import { emptyRequirementForm } from "@/lib/validation/requirement";

// A Storage in memory, as the browser's sessionStorage behaves for these calls.
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { sessionStorage: memoryStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requirement drafts in the tab (FR-M1 AC12)", () => {
  it("keys a draft by user and organisation and reads back only a draft of the form's shape", () => {
    const key = requirementDraftKey("user-1", "acme-bau");
    expect(key).toBe("chara:requirement-draft:user-1:acme-bau");
    writeRequirementDraft(key, { ...emptyRequirementForm, workersNeeded: "50" });
    expect(readRequirementDraft(key)).toMatchObject({ workersNeeded: "50" });
    expect(readRequirementDraft(requirementDraftKey("user-2", "acme-bau"))).toBeNull();
    window.sessionStorage.setItem(key, JSON.stringify({ workersNeeded: 50 }));
    expect(readRequirementDraft(key)).toBeNull();
  });

  it("removes every requirement draft before log out and nothing else", () => {
    writeRequirementDraft(requirementDraftKey("user-1", "acme-bau"), emptyRequirementForm);
    writeRequirementDraft(requirementDraftKey("user-2", "beta-works"), emptyRequirementForm);
    window.sessionStorage.setItem("other", "kept");
    clearRequirementDrafts();
    expect(window.sessionStorage.length).toBe(1);
    expect(window.sessionStorage.getItem("other")).toBe("kept");
  });

  it("ignores storage that throws", () => {
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(() => clearRequirementDrafts()).not.toThrow();
    expect(readRequirementDraft("chara:requirement-draft:u:s")).toBeNull();
  });
});
