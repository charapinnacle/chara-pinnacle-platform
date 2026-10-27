import { ConnectionActions } from "@/components/connections/connection-actions";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { hasConnectionActions, type ConnectionAccess } from "@/lib/connections/access";
import { getConnectionStates } from "@/lib/dal/connections";
import type { Requirement } from "@/lib/dal/requirements";
import { countryInSentence, formatDate } from "@/lib/i18n/format";
import { partnerDirectoryPath, type PartnerDirectoryKind } from "@/lib/partners/search-params";
import {
  criteriaLists,
  partnerKindText,
  suggestionCountText,
  suggestionSentence,
  type Suggestion,
} from "@/lib/requirements/suggestions";
import { partnerProfilePath } from "@/lib/routes";

const directoryLabels: Record<PartnerDirectoryKind, string> = {
  recruitment: "Find Recruitment Partners",
  staffing: "Find Staffing Partners",
};

// The directories that hold the partner types the requirement asks for, filtered to its country and its largest
// occupation (a directory search takes one occupation).
function DirectoryLinks({ lang, requirement, kinds }: { lang: string; requirement: Requirement; kinds: PartnerDirectoryKind[] }) {
  const filters = { destination: requirement.countryCode, occupation: requirement.occupations[0]?.code, limit: 20 };
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {kinds.map((kind) => (
        <TextLink key={kind} standalone href={partnerDirectoryPath(lang, kind, filters)}>
          {directoryLabels[kind]}
        </TextLink>
      ))}
    </div>
  );
}

function CriteriaList({ label, items, met }: { label: string; items: string[]; met: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="grid gap-1">
      <p className="text-small font-medium">{met ? "Criteria met" : "Criteria not met"}</p>
      <ul aria-label={label} className="grid list-disc gap-0.5 ps-5 text-small text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

type CardProps = {
  lang: string;
  suggestion: Suggestion;
  connection: ConnectionAccess;
  saved: boolean;
  following: boolean;
};

// One suggestion with its reasons (FR-M3 step Explain, AC7): the facts, the criteria met and not met in words, the
// profile and Save partner. No score, rank, plan or word of verification [d1.1].
function SuggestionCard({ lang, suggestion, connection, saved, following }: CardProps) {
  const profilePath = partnerProfilePath(lang, suggestion.slug);
  const { met, notMet } = criteriaLists(suggestion);
  return (
    <li className="grid gap-4 py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-6">
      <div className="grid min-w-0 gap-2">
        <div className="grid gap-1">
          <h2 className="text-h2">
            <TextLink href={profilePath} className="break-words">
              {suggestion.displayName}
            </TextLink>
          </h2>
          <p className="text-small text-muted-foreground">{partnerKindText(suggestion)}</p>
        </div>
        <p className="text-body break-words">{suggestionSentence(suggestion)}</p>
        {suggestion.listing ? (
          <p className="text-small text-muted-foreground">
            Listing confirmed <time dateTime={suggestion.listing.confirmedAt}>{formatDate(suggestion.listing.confirmedAt)}</time>
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <CriteriaList label={`Criteria met by ${suggestion.displayName}`} items={met} met />
          <CriteriaList label={`Criteria not met by ${suggestion.displayName}`} items={notMet} met={false} />
        </div>
      </div>
      {hasConnectionActions(connection) ? (
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <ConnectionActions
            lang={lang}
            organizationId={suggestion.organizationId}
            name={suggestion.displayName}
            access={connection}
            saved={saved}
            following={following}
            next={profilePath}
          />
        </div>
      ) : null}
    </li>
  );
}

type PartnerSuggestionsProps = {
  lang: string;
  requirement: Requirement;
  suggestions: Suggestion[];
  more: boolean;
};

// The suggested partners of a requirement (FR-M3 steps Select to Explain, AC7, AC10, AC11): the count in a polite live
// region, the cards, the directories when more partners fit, and an empty state that leads to the directories.
export async function PartnerSuggestions({ lang, requirement, suggestions, more }: PartnerSuggestionsProps) {
  const kinds: PartnerDirectoryKind[] =
    requirement.partnerNeed === "both" ? ["recruitment", "staffing"] : requirement.partnerNeed === "staffing" ? ["staffing"] : ["recruitment"];
  const country = countryInSentence(requirement.countryCode, requirement.country);

  if (suggestions.length === 0) {
    return (
      <div role="status">
        <EmptyState
          title={`No listed partners serve ${country} for these occupations yet`}
          description="Look for partners in the directories, or come back later."
        >
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <TextLink standalone href={partnerDirectoryPath(lang, "recruitment")}>
              Recruitment Partners
            </TextLink>
            <TextLink standalone href={partnerDirectoryPath(lang, "staffing")}>
              Staffing Partners
            </TextLink>
          </div>
        </EmptyState>
      </div>
    );
  }

  const connections = await getConnectionStates(suggestions.map(({ organizationId, organizationType }) => ({ id: organizationId, type: organizationType })));
  return (
    <div className="grid gap-4">
      <p role="status" aria-live="polite" className="text-body text-muted-foreground">
        {suggestionCountText(suggestions.length, more)}
      </p>
      <ul className="animate-stagger divide-y border-y" aria-label="Suggested partners">
        {suggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.organizationId}
            lang={lang}
            suggestion={suggestion}
            connection={connections.access.get(suggestion.organizationId) ?? { kind: "none" }}
            saved={connections.saved.has(suggestion.organizationId)}
            following={connections.followed.has(suggestion.organizationId)}
          />
        ))}
      </ul>
      {more ? <DirectoryLinks lang={lang} requirement={requirement} kinds={kinds} /> : null}
    </div>
  );
}
