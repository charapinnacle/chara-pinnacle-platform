import { renderToStaticMarkup } from "react-dom/server";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { InviteCheckbox } from "@/components/invitations/invite-selection";
import type { InviteSelectionInput } from "@/lib/validation/invitation";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/invitations", () => ({ invitePartners: vi.fn() }));
vi.mock("@/lib/actions/limits", () => ({ recordLimitPrompt: vi.fn() }));

function Card({ partners }: { partners: { id: string; name: string }[] }) {
  const form = useForm<InviteSelectionInput>({ defaultValues: { partners: [] } });
  return (
    <FormProvider {...form}>
      {partners.map(({ id, name }) => (
        <InviteCheckbox key={id} partnerId={id} name={name} />
      ))}
    </FormProvider>
  );
}

describe("the invite checkbox of a suggestion card (FR-M3 AC7, FR-O1 AC12)", () => {
  it("labels every box with the partner's name in visible text, so no two boxes are both just Invite", () => {
    const html = renderToStaticMarkup(
      <Card
        partners={[
          { id: "00000000-0000-4000-8000-000000000001", name: "Baltic Crew" },
          { id: "00000000-0000-4000-8000-000000000002", name: "Nordic Staff" },
        ]}
      />,
    );
    expect(html).toMatch(/<label for="invite-00000000-0000-4000-8000-000000000001"[^>]*>Invite Baltic Crew<\/label>/);
    expect(html).toMatch(/<label for="invite-00000000-0000-4000-8000-000000000002"[^>]*>Invite Nordic Staff<\/label>/);
    expect(html).not.toContain("sr-only");
  });
});
