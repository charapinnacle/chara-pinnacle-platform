import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { vacancyDecisionId } = await import("@/lib/dal/appeals");

const row = (id: number) => ({
  moderation_action_id: id, target_type: "job", target_id: "job-1", action: "job_hidden", title: "Welder", organization_id: "org-1",
  organization_name: "Acme Bau", org_slug: "acme-bau", reasons: "A fee demand.", decided_at: "2026-10-20T09:00:00+00:00",
  appeal_until: "2027-04-20T09:00:00+00:00", in_effect: true, can_appeal: true, target_days: 7, appeal_id: null, appeal_status: null,
  grounds: null, lodged_at: null, due_at: null, appeal_reasons: null, appeal_decided_at: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
});

// FR-S1 AC12: the vacancy page finds the decision on its own vacancy, however many decisions the organisation has.
describe("vacancyDecisionId", () => {
  it("asks for the decisions on the vacancy only and takes the newest hide", async () => {
    rpcMock.mockResolvedValue({ data: [row(9), row(4)], error: null });
    expect(await vacancyDecisionId("job-1")).toBe(9);
    expect(rpcMock).toHaveBeenCalledWith("list_my_appeals", { p_job: "job-1" });
  });

  it("is null without a decision in the window, and asks nothing while release 2a is off", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    expect(await vacancyDecisionId("job-1")).toBeNull();
    rpcMock.mockClear();
    releasedMock.mockResolvedValue(false);
    expect(await vacancyDecisionId("job-1")).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
