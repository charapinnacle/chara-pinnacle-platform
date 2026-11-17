import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/en/messages/x" }));
vi.mock("@/lib/actions/connection-actions", () => ({ declineConnection: vi.fn() }));

const { TypedMessageCard } = await import("@/components/connections/typed-message-card");
const { ConfirmRemoveButton } = await import("@/components/passport/confirm-remove-button");

const render = async (element: React.ReactNode) => {
  const { prelude } = await prerender(element);
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
};

// Button labels are shown in Title Case (form-button.tsx); what a person wrote keeps its own case.
describe("user text inside Title Case buttons", () => {
  it("keeps the vacancy title of Apply out of the transform", async () => {
    const html = await render(
      <TypedMessageCard
        lang="en"
        card={{
          kind: "invite_to_job",
          connectionId: "11111111-1111-4111-8111-111111111111",
          label: "Invitation to apply",
          chip: { text: "Not applied yet", cue: "waiting" },
          details: [],
          actions: [{ type: "apply", jobId: "22222222-2222-4222-8222-222222222222", vacancy: "Welders and flame cutters" }],
          note: null,
        }}
      />,
    );
    expect(html).toContain('Apply to <span class="normal-case">Welders and flame cutters</span>');
  });

  it("keeps a course name in the screen reader text of Remove out of the transform", async () => {
    const html = await render(<ConfirmRemoveButton name="<b>Welding</b> MIG course" removed="Training removed" remove={vi.fn()} />);
    expect(html).toContain('Remove<span class="sr-only normal-case"> &lt;b&gt;Welding&lt;/b&gt; MIG course</span>');
  });
});
