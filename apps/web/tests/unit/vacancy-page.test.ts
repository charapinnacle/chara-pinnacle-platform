import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicJob } from "@/lib/dal/hiring";

const getPublicJobMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getSavedJobIdsMock = vi.hoisted(() => vi.fn());
const logMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/lib/dal/hiring", () => ({ getPublicJob: getPublicJobMock }));
vi.mock("@/lib/dal/saved-jobs", () => ({ getSavedJobIds: getSavedJobIdsMock }));
vi.mock("@/lib/dal/session", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/jobs/vacancy-log", () => ({ logVacancy: logMock }));
vi.mock("@/lib/jobs/job-posting", () => ({ jobPostingJsonLd: () => "{}" }));
vi.mock("@/components/jobs/vacancy-view", () => ({ VacancyView: () => null }));
vi.mock("@/components/jobs/vacancy-actions", () => ({ VacancyActions: () => null }));

const { default: PublicJobPage } = await import("@/app/[lang]/(public)/jobs/[id]/page");

const id = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const props = (value: string) => ({ params: Promise.resolve({ lang: "en", id: value }) }) as Parameters<typeof PublicJobPage>[0];

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue(null);
  getSavedJobIdsMock.mockResolvedValue(new Set());
});

type Props = { children: [unknown, ReactElement<{ actions: ReactElement<Record<string, unknown>> }>] };

// The props the page gives to the actions of the vacancy view.
const actionProps = (page: unknown) => (page as ReactElement<Props>).props.children[1].props.actions.props;

describe("PublicJobPage view events", () => {
  it("logs an ok view with the vacancy and the viewer", async () => {
    getPublicJobMock.mockResolvedValue({ id, employer: {} } as PublicJob);
    getCurrentUserMock.mockResolvedValue({ accountKind: "worker" });
    await PublicJobPage(props(id));
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith({ event: "vacancy_view", outcome: "ok", jobId: id, viewer: "candidate" });
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("tells a candidate whether the vacancy is saved, asking about this vacancy only", async () => {
    getPublicJobMock.mockResolvedValue({ id, title: "Welder", employer: {} } as PublicJob);
    getCurrentUserMock.mockResolvedValue({ accountKind: "worker" });
    getSavedJobIdsMock.mockResolvedValue(new Set([id]));
    expect(actionProps(await PublicJobPage(props(id)))).toMatchObject({ viewer: "candidate", saved: true, lang: "en" });
    expect(getSavedJobIdsMock).toHaveBeenCalledWith([id]);

    getSavedJobIdsMock.mockResolvedValue(new Set());
    expect(actionProps(await PublicJobPage(props(id)))).toMatchObject({ viewer: "candidate", saved: false });
  });

  it("does not ask who saved the vacancy for a visitor or a company user", async () => {
    getPublicJobMock.mockResolvedValue({ id, title: "Welder", employer: {} } as PublicJob);
    expect(actionProps(await PublicJobPage(props(id)))).toMatchObject({ viewer: "visitor", saved: false });
    getCurrentUserMock.mockResolvedValue({ accountKind: "company" });
    expect(actionProps(await PublicJobPage(props(id)))).toMatchObject({ viewer: "company", saved: false });
    expect(getSavedJobIdsMock).not.toHaveBeenCalled();
  });

  it("logs an unavailable view without an id, before the not-found page", async () => {
    getPublicJobMock.mockResolvedValue(null);
    await expect(PublicJobPage(props(id))).rejects.toThrow("NOT_FOUND");
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith({ event: "vacancy_view", outcome: "unavailable", viewer: "visitor" });
    expect(logMock.mock.invocationCallOrder[0]).toBeLessThan(notFoundMock.mock.invocationCallOrder[0]);
  });

  it("logs an unavailable view for an id that is not a uuid, without reading the vacancy", async () => {
    await expect(PublicJobPage(props("../x"))).rejects.toThrow("NOT_FOUND");
    expect(getPublicJobMock).not.toHaveBeenCalled();
    expect(logMock).toHaveBeenCalledWith({ event: "vacancy_view", outcome: "unavailable", viewer: "visitor" });
  });

  it("logs nothing when the read fails", async () => {
    getPublicJobMock.mockRejectedValue(new Error("db down"));
    await expect(PublicJobPage(props(id))).rejects.toThrow("db down");
    expect(logMock).not.toHaveBeenCalled();
  });
});
