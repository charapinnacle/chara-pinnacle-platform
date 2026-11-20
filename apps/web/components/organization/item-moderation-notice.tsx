import { AppealState } from "@/components/appeals/appeal-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import type { AppealableDecision } from "@/lib/dal/appeals";
import type { ItemModeration } from "@/lib/dal/item-moderation";
import { formatDate } from "@/lib/i18n/format";
import { appealsPath } from "@/lib/routes";

type ItemModerationNoticeProps = {
  lang: string;
  // What the item is to the organisation, for example "response" or "requirement".
  kind: string;
  // What hiding does, for example "The employer no longer sees it".
  effect: string;
  moderation: ItemModeration | null;
  appeal: AppealableDecision | null;
};

// A job order, response or submission hidden by moderation (FR-S1 AC12, DSA Art. 17 and 20): every member reads the
// badge, the statement of reasons and the state of an appeal; the owner and admins get the Appeal button.
export function ItemModerationNotice({ lang, kind, effect, moderation, appeal }: ItemModerationNoticeProps) {
  if (moderation?.state !== "hidden") return null;
  return (
    <Notice tone="warning" role="status" aria-labelledby="moderation-heading">
      <div className="grid gap-2">
        <h2 id="moderation-heading" className="flex flex-wrap items-center gap-2 text-body font-semibold">
          <StatusBadge status="danger">Hidden by moderation</StatusBadge>
          {`This ${kind} is hidden`}
        </h2>
        <p>
          Our moderators hid it{moderation.decision ? ` on ${formatDate(moderation.decision.decidedAt)}` : ""}. {effect}.
        </p>
        {moderation.decision ? (
          <div className="grid gap-1">
            <p className="font-semibold">Statement of reasons</p>
            <blockquote className="border-s-2 border-warning-border ps-3 whitespace-pre-line wrap-anywhere">{moderation.decision.reasons}</blockquote>
          </div>
        ) : null}
        {appeal ? (
          <AppealState decision={appeal} />
        ) : (
          <p>
            <TextLink href={appealsPath(lang)}>See the moderation decisions and their appeals</TextLink>
          </p>
        )}
      </div>
    </Notice>
  );
}
