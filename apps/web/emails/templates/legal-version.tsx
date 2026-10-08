import { Action, Layout, Paragraph, Quote } from "../layout.tsx";
import { field, humanize, url } from "../payload.ts";
import type { Template } from "../template.ts";

export const legalVersion: Template = {
  subject: (payload) => `We updated our ${humanize(field(payload, "document_slug") ?? "legal document")}`,
  Body: ({ payload, siteUrl }) => {
    const slug = field(payload, "document_slug");
    const name = humanize(slug ?? "legal document");
    const summary = field(payload, "change_summary");
    return (
      <Layout preview={`A new version of the ${name} is available`} heading="A legal document changed">
        <Paragraph>
          We published a new version of the {name}. You can read what changed and, where it is needed, accept it the next time you sign in.
        </Paragraph>
        {summary ? <Quote>{summary}</Quote> : null}
        {slug ? <Action href={url(siteUrl, `/legal/${slug}`)}>Read the {name}</Action> : null}
      </Layout>
    );
  },
};
