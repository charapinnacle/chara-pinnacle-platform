import { Notice } from "@/components/forms/notice";
import type { ResponseDetail } from "@/lib/dal/responses";
import { formatDate } from "@/lib/i18n/format";
import { feeModelLabels, feeText, NOT_A_PARTY, NOT_A_PARTY_EMPLOYER, workersOfferedText } from "@/lib/responses/presentation";

// The proposal of a response as get_response returns it, and nothing more (NFR-S11, FR-O2 AC1 read view, AC10): the
// workers offered, from when, the timeline, the experience, the fee and the notes, with the statement that the platform
// is not a party next to the fee.
export function ResponseView({ response, view }: { response: ResponseDetail; view: "partner" | "employer" }) {
  const details: (readonly [string, React.ReactNode])[] = [
    ["Workers offered", `${workersOfferedText(response.capacity)} of ${workersOfferedText(response.workersNeeded)} needed`],
    ["Available from", <time key="from" dateTime={response.availableFrom}>{formatDate(response.availableFrom)}</time>],
    ["Fee model", feeModelLabels[response.feeModel]],
    ["Fee", feeText(response.feeModel, response.feeAmount, response.feeCurrency)],
  ];
  const texts: (readonly [string, string | null])[] = [
    ["Timeline", response.timelineNote],
    ["Relevant experience", response.experienceNote],
    ["Notes", response.notes],
  ];
  return (
    <section aria-labelledby="response-proposal-heading" className="grid gap-4">
      <h2 id="response-proposal-heading" className="text-h2">
        The proposal
      </h2>
      <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
        {details.map(([term, value]) => (
          <div key={term} className="grid content-start gap-0.5 bg-card p-card">
            <dt className="text-small text-muted-foreground">{term}</dt>
            <dd className="font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <Notice tone="info" role="note">
        {view === "partner" ? NOT_A_PARTY : NOT_A_PARTY_EMPLOYER}.
      </Notice>
      {texts.map(([term, value]) =>
        value ? (
          <div key={term} className="grid gap-1">
            <h3 className="text-h3">{term}</h3>
            <p className="max-w-[65ch] leading-7 break-words whitespace-pre-line">{value}</p>
          </div>
        ) : null,
      )}
    </section>
  );
}
