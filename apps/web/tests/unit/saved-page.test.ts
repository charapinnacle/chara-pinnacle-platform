import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.hoisted(() => vi.fn());
const listMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/dal/saved-jobs", () => ({ listSavedJobs: listMock }));
vi.mock("@/components/saved/saved-list", () => ({ SavedList: () => null }));

const { default: SavedPage } = await import("@/app/[lang]/(app)/saved/page");

const cursor = "2026-10-06T10:00:00.123456Z|6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const props = (search: Record<string, string | string[]> = {}) =>
  ({ params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve(search) }) as Parameters<typeof SavedPage>[0];

type ListProps = { children: [unknown, ReactElement<Record<string, unknown>>] };
const listProps = (page: unknown) => (page as ReactElement<ListProps>).props.children[1].props;

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "u", accountKind: "worker" });
  listMock.mockResolvedValue({ jobs: [], nextCursor: null });
});

describe("SavedPage", () => {
  it("checks the visitor before it reads anything: requireUser sends them to log in", async () => {
    requireUserMock.mockRejectedValue(new Error("REDIRECT:/en/login?next=%2Fen%2Fsaved"));
    await expect(SavedPage(props())).rejects.toThrow("REDIRECT:/en/login");
    expect(requireUserMock).toHaveBeenCalledWith("en");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("gives a company user the not-found page and reads nothing", async () => {
    requireUserMock.mockResolvedValue({ id: "u", accountKind: "company" });
    await expect(SavedPage(props())).rejects.toThrow("NOT_FOUND");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("sends an account that has not chosen its kind to onboarding", async () => {
    requireUserMock.mockResolvedValue({ id: "u", accountKind: null });
    await expect(SavedPage(props())).rejects.toThrow("REDIRECT:/en/onboarding");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("reads the first page for a candidate and links the next one", async () => {
    listMock.mockResolvedValue({ jobs: [], nextCursor: cursor });
    expect(listProps(await SavedPage(props()))).toMatchObject({
      nextHref: `/en/saved?cursor=${encodeURIComponent(cursor)}`,
      firstHref: null,
    });
    expect(listMock).toHaveBeenCalledWith(null);
  });

  it("reads the page of a cursor in the address and offers the way back to the first page", async () => {
    expect(listProps(await SavedPage(props({ cursor })))).toMatchObject({ nextHref: null, firstHref: "/en/saved" });
    expect(listMock).toHaveBeenCalledWith(cursor);
  });

  it("shows the first page for a cursor that is not one of ours, never an error", async () => {
    for (const bad of ["x|y", ["a", "b"], "2026-13-45T00:00:00.000000Z|6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11"]) {
      listMock.mockClear();
      expect(listProps(await SavedPage(props({ cursor: bad })))).toMatchObject({ firstHref: null });
      expect(listMock).toHaveBeenCalledWith(null);
    }
  });
});
