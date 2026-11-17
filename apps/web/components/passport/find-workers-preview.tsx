import { WorkerCard, type CardNames } from "@/components/find-workers/worker-card";
import { FindWorkersSection } from "@/components/passport/find-workers-section";
import { getLegalDocument } from "@/lib/dal/legal";
import type { OccupationItem, ReferenceItem } from "@/lib/dal/reference";
import { getMyCard, VISIBILITY_CONSENT_SLUG } from "@/lib/dal/worker-visibility";
import { CARD_NEVER_SHOWS, CARD_SHOWS } from "@/lib/find-workers/card";

type FindWorkersPreviewProps = {
  countries: ReferenceItem[];
  languages: ReferenceItem[];
  occupations: OccupationItem[];
  industries: ReferenceItem[];
};

function byCode(items: ReferenceItem[]): Record<string, string> {
  return Object.fromEntries(items.map((item) => [item.code, item.name]));
}

function List({ id, title, items }: { id: string; title: string; items: readonly string[] }) {
  return (
    <div className="grid gap-2">
      <h3 id={id} className="text-body font-medium">
        {title}
      </h3>
      <ul aria-labelledby={id} className="grid list-disc gap-1 ps-5 text-body">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

// The Find Workers part of the passport (FR-Q1 AC9; SOP step Offer): what companies will and will not see, the worker's
// own card drawn by the component of the search, and the switches. Shown while release 2c is on.
export async function FindWorkersPreview({ countries, languages, occupations, industries }: FindWorkersPreviewProps) {
  const [mine, document] = await Promise.all([getMyCard(), getLegalDocument(VISIBILITY_CONSENT_SLUG)]);
  if (!mine) return null;
  const names: CardNames = {
    countries: byCode(countries),
    languages: byCode(languages),
    industries: byCode(industries),
    occupations: Object.fromEntries(occupations.map((item) => [item.code, item.label])),
  };
  return (
    <div className="grid gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <List id="find-workers-shows" title="Companies will see" items={CARD_SHOWS} />
        <List id="find-workers-never" title="Companies will never see" items={CARD_NEVER_SHOWS} />
      </div>
      <div className="grid gap-2">
        <h3 className="text-body font-medium">Preview of your card</h3>
        <WorkerCard card={mine.card} names={names} headingLevel="h4" />
      </div>
      <FindWorkersSection
        optedIn={mine.optedIn}
        hiddenByAccount={mine.optedIn && !mine.visible}
        visibleSince={mine.visibleSince}
        confirmBy={mine.confirmBy}
        sections={mine.sections}
        consent={
          document
            ? { slug: VISIBILITY_CONSENT_SLUG, version: document.version, title: document.title, body: document.body, isDraft: document.isDraft }
            : null
        }
      />
    </div>
  );
}
