import { Layout, Paragraph } from "../layout.tsx";
import { field } from "../payload.ts";
import type { Template } from "../template.ts";

export const erasurePaused: Template = {
  subject: () => "An account erasure is on hold",
  Body: ({ payload }) => (
    <Layout preview="An account erasure is on hold" heading="An account erasure is on hold">
      <Paragraph>
        The erasure of account {field(payload, "account_id") ?? "(unknown)"} is due but a legal hold is set on it. It stays paused until the hold is
        cleared.
      </Paragraph>
    </Layout>
  ),
};
