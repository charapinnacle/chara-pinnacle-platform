import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, longDate, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-Q1 AC8 (SOP step Remind): a year after the worker last turned the Find Workers card on, the worker is asked whether
// it should stay. The payload holds only the end of the answer period; never the card or the name (NFR-S9).
export const visibilityConfirmation: Template = {
  subject: () => "Should your card stay in Find Workers?",
  Body: ({ payload, siteUrl }) => {
    const by = longDate(field(payload, "respond_by"));
    return (
      <Layout preview="Confirm that your card should stay in Find Workers" heading="Should your card stay in Find Workers?">
        <Paragraph>
          A year ago you chose to show your card in Find Workers, where employers and recruitment companies can find you without
          seeing your name or contact details.
        </Paragraph>
        <Paragraph>
          Please confirm that it should stay{by ? ` by ${by}` : " within 30 days"}. Without an answer, your card is hidden from
          Find Workers; you can turn it on again at any time.
        </Paragraph>
        <Action href={url(siteUrl, "/passport#find-workers")}>Confirm or turn off</Action>
      </Layout>
    );
  },
};
