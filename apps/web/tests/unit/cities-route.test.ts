import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const suggestMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/reference", () => ({ suggestCities: suggestMock }));

const { GET } = await import("@/app/api/cities/route");

const call = (query: string) => GET(new NextRequest(`http://localhost/api/cities?${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  suggestMock.mockResolvedValue(["Berlin", "Bergen"]);
});

describe("the city suggestions route", () => {
  it("answers the names of the country for the text, cacheable by browsers and the CDN", async () => {
    const response = await call("country=DE&q=Be");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cities: ["Berlin", "Bergen"] });
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300, stale-while-revalidate=3600");
    expect(suggestMock).toHaveBeenCalledWith("DE", "Be");
  });

  it("takes a missing text as empty", async () => {
    await call("country=DE");
    expect(suggestMock).toHaveBeenCalledWith("DE", "");
  });

  it.each(["", "country=de&q=Be", "country=DEU&q=Be", "country=D1", `country=DE&q=${"a".repeat(101)}`])(
    "refuses %s without asking the database",
    async (query) => {
      const response = await call(query);
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(suggestMock).not.toHaveBeenCalled();
    },
  );

  it("answers an empty list that is not cached when the database fails", async () => {
    suggestMock.mockRejectedValue(new Error("down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await call("country=DE&q=Be");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ cities: [] });
    expect(response.headers.get("cache-control")).toBe("no-store");
    error.mockRestore();
  });
});
