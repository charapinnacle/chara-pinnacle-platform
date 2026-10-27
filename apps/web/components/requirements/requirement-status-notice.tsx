import { Notice } from "@/components/forms/notice";
import type { Requirement } from "@/lib/dal/requirements";
import { formatDate } from "@/lib/i18n/format";
import { isClosingSoon } from "@/lib/requirements/lifecycle";
import { closeReasonTexts, requirementStatusNotices } from "@/lib/requirements/presentation";

type RequirementStatusNoticeProps = {
  requirement: Pick<Requirement, "status" | "closesOn" | "closeReason" | "statusChangedAt">;
  today: string;
  reminderDays: number;
};

// The status of a requirement, what it means for partners and the date that matters next (FR-M2 AC12, NFR-U4): the
// closing date of an open or paused requirement, a warning once it closes within the reminder period, and when and why
// a closed or filled one ended.
export function RequirementStatusNotice({ requirement, today, reminderDays }: RequirementStatusNoticeProps) {
  const { status, closesOn, closeReason, statusChangedAt } = requirement;
  const soon = status === "open" && closesOn !== null && isClosingSoon(closesOn, today, reminderDays);
  const closes = closesOn ? (
    <p>
      Closes on <time dateTime={closesOn}>{formatDate(closesOn)}</time>
    </p>
  ) : null;
  return (
    <Notice tone={soon ? "warning" : "info"} role="status">
      <p className="font-medium">{requirementStatusNotices[status]}</p>
      {status === "open" ? closes : null}
      {soon ? <p>Extend it if you still need workers; partners can respond until then.</p> : null}
      {status === "paused" ? (
        <>
          {closes}
          <p>A paused requirement is not closed on that date. If the date has passed, extend it before you reopen it.</p>
        </>
      ) : null}
      {(status === "closed" || status === "filled") && closeReason ? (
        <p>
          {closeReasonTexts[closeReason]} on <time dateTime={statusChangedAt}>{formatDate(statusChangedAt)}</time>.
        </p>
      ) : null}
    </Notice>
  );
}
