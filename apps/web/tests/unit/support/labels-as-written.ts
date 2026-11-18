import { vi } from "vitest";

// Component tests read button labels as written; the lower-case small words of their Title Case are covered on their own
// in title-text.test.tsx.
vi.mock("@/components/forms/title-text", () => ({ titleText: (children: unknown) => children }));
