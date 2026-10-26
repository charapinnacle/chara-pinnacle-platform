import { StatusBadge } from "@/components/feedback/status-badge";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import type { PartnerProfileModeration } from "@/lib/dal/partner-profile";
import { formatDate } from "@/lib/i18n/format";

// The partner sees that its profile was hidden by moderation and why (FR-S1 AC12, DSA Art. 17): every member reads the
// badge and the statement of reasons. The appeal route is the Complaints and Dispute Process until the appeal form (V28).
export function ModerationNotice({ lang, moderation }: { lang: string; moderation: PartnerProfileModeration }) {
  if (moderation.state !== "hidden") return null;
  return (
    <Notice tone="warning" role="status" aria-labelledby="moderation-heading">
      <div className="grid gap-2">
        <h2 id="moderation-heading" className="flex flex-wrap items-center gap-2 text-body font-semibold">
          <StatusBadge status="danger">Hidden by moderation</StatusBadge>
          Your partner profile is not shown to anyone
        </h2>
        <p>
          Our moderators hid it{moderation.decision ? ` on ${formatDate(moderation.decision.decidedAt)}` : ""}. It is not in
          the partner directories and employers cannot open it. Your team can still edit it.
        </p>
        {moderation.decision ? (
          <div className="grid gap-1">
            <p className="font-semibold">Statement of reasons</p>
            <blockquote className="border-s-2 border-warning-border ps-3 whitespace-pre-line wrap-anywhere">{moderation.decision.reasons}</blockquote>
          </div>
        ) : null}
        <p>
          If you think this was a mistake, you can appeal.{" "}
          <TextLink href={`/${lang}/legal/complaints-and-dispute-process`}>How to appeal</TextLink>
        </p>
      </div>
    </Notice>
  );
}
