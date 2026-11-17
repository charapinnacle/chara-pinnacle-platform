"use client";

import { useId, useState, useTransition } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { StatusBadge } from "@/components/feedback/status-badge";
import { toast, toastError, toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import { SwitchControl } from "@/components/forms/switch-control";
import { LegalLink } from "@/components/forms/text-link";
import { setCardSections, setWorkerVisibility } from "@/lib/actions/worker-visibility";
import type { CardSections } from "@/lib/dal/worker-visibility";
import { formatDate } from "@/lib/i18n/format";
import { isRedirectError } from "@/lib/redirect-error";
import { displayTitle } from "@/lib/validation/consents";

const VISIBILITY_FAILED = "Your Find Workers card was not changed";
const SECTIONS_FAILED = "Your card sections were not changed";

export type VisibilityConsent = { slug: string; version: number; title: string; body: string; isDraft: boolean };

type FindWorkersSectionProps = {
  optedIn: boolean;
  // Opted in, but the account is suspended or being deleted, so the card is not listed.
  hiddenByAccount: boolean;
  visibleSince: string | null;
  confirmBy: string | null;
  sections: CardSections;
  consent: VisibilityConsent | null;
};

const SECTION_LABELS: { key: keyof CardSections; label: string; description: string }[] = [
  { key: "training", label: "Training", description: "Courses and qualifications, with the provider and the year." },
  { key: "employmentHistory", label: "Employment history", description: "Roles, countries and months; never the employer's name." },
  { key: "industries", label: "Preferred industries", description: "With your preferred employment types." },
];

function SectionSwitch({
  label,
  description,
  checked,
  pending,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <li className="flex items-start justify-between gap-6">
      <div className="grid gap-0.5">
        <span id={labelId} className="font-medium">
          {label}
        </span>
        <p id={descriptionId} className="text-small text-muted-foreground">
          {description}
        </p>
      </div>
      <SwitchControl checked={checked} pending={pending} labelledBy={labelId} describedBy={descriptionId} onToggle={onToggle} />
    </li>
  );
}

// The opt-in of the Find Workers card on the passport (FR-Q1 AC9, AC10; NFR-C4): turning it on asks first, in a dialog
// that quotes the consent wording and links its version; turning it off takes effect at once. Once visible, the worker
// chooses the optional sections. Each switch shows the new state while its call runs and returns to the previous one when
// the call fails, with an error toast. While the yearly reminder waits, Keep my card visible confirms through the same
// dialog (AC8).
export function FindWorkersSection({ optedIn, hiddenByAccount, visibleSince: since, confirmBy: due, sections: initialSections, consent }: FindWorkersSectionProps) {
  const [visible, setVisible] = useState(optedIn);
  const [visibleSince, setVisibleSince] = useState(since);
  const [confirmBy, setConfirmBy] = useState(due);
  const [sections, setSections] = useState(initialSections);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sectionsPending, startSections] = useTransition();
  const labelId = useId();
  const descriptionId = useId();

  function turnOn() {
    if (!consent) return;
    const previous = { visible, visibleSince, confirmBy };
    const confirmation = visible;
    setConfirming(false);
    setVisible(true);
    startTransition(async () => {
      try {
        const result = await setWorkerVisibility(true, consent.version);
        if (result.message !== undefined) {
          setVisible(previous.visible);
          toastError(VISIBILITY_FAILED, result.message);
          return;
        }
        setVisibleSince(result.visibleSince);
        setConfirmBy(null);
        toast({
          title: confirmation ? "Your card stays visible in Find Workers" : "Your card is visible in Find Workers",
          description: "You can turn it off at any time.",
        });
      } catch (error) {
        if (isRedirectError(error)) return;
        setVisible(previous.visible);
        toastNetworkError(VISIBILITY_FAILED);
      }
    });
  }

  function turnOff() {
    setVisible(false);
    startTransition(async () => {
      try {
        const result = await setWorkerVisibility(false, null);
        if (result.message !== undefined) {
          setVisible(true);
          toastError(VISIBILITY_FAILED, result.message);
          return;
        }
        setVisibleSince(null);
        setConfirmBy(null);
        toast({ title: "Your card is hidden from Find Workers", description: "Companies no longer find you. Your conversations stay." });
      } catch (error) {
        if (isRedirectError(error)) return;
        setVisible(true);
        toastNetworkError(VISIBILITY_FAILED);
      }
    });
  }

  function toggleSection(key: keyof CardSections) {
    const previous = sections;
    const next = { ...sections, [key]: !sections[key] };
    setSections(next);
    startSections(async () => {
      try {
        const result = await setCardSections(next);
        if (result.message !== undefined) {
          setSections(previous);
          toastError(SECTIONS_FAILED, result.message);
          return;
        }
        toast({ title: "Your card sections were saved" });
      } catch (error) {
        if (isRedirectError(error)) return;
        setSections(previous);
        toastNetworkError(SECTIONS_FAILED);
      }
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-6">
        <div className="grid gap-1">
          <span id={labelId} className="font-medium">
            Show my card in Find Workers
          </span>
          <p id={descriptionId} className="text-small text-muted-foreground">
            {!visible
              ? "Not visible: companies cannot find you"
              : hiddenByAccount
                ? "Hidden while your account is suspended or being deleted"
                : `Visible since ${visibleSince ? formatDate(visibleSince) : "today"}`}
          </p>
        </div>
        <SwitchControl
          checked={visible}
          pending={pending || !consent}
          labelledBy={labelId}
          describedBy={descriptionId}
          onToggle={() => {
            if (visible) turnOff();
            else setConfirming(true);
          }}
        />
      </div>
      {!consent ? <p className="text-small text-muted-foreground">Find Workers cannot be turned on at the moment.</p> : null}

      {visible && confirmBy ? (
        <Notice tone="warning" role="status">
          <div className="grid gap-3">
            <p>
              Please confirm by {formatDate(confirmBy)} that your card should stay in Find Workers. Without an answer it is hidden on that
              date.
            </p>
            <FormButton type="button" className="w-auto justify-self-start" onClick={() => setConfirming(true)} disabled={pending || !consent}>
              Keep my card visible
            </FormButton>
          </div>
        </Notice>
      ) : null}

      {visible ? (
        <div className="grid gap-2">
          <h3 className="text-body font-medium">Also show on my card</h3>
          <ul className="grid gap-3">
            {SECTION_LABELS.map((item) => (
              <SectionSwitch
                key={item.key}
                label={item.label}
                description={item.description}
                checked={sections[item.key]}
                pending={sectionsPending}
                onToggle={() => toggleSection(item.key)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {consent ? (
        <ModalDialog open={confirming} onClose={() => setConfirming(false)} title="Show your card in Find Workers?">
          <p className="text-body leading-relaxed">
            Employers and recruitment companies will see your card without your name, photo, contact details or documents. You can turn it
            off at any time, and we ask you once a year whether it should stay.
          </p>
          <div
            role="region"
            tabIndex={0}
            aria-label="Consent wording"
            className="max-h-48 overflow-y-auto rounded-lg border bg-secondary p-4 text-small leading-relaxed"
          >
            <blockquote className="whitespace-pre-line">{consent.body}</blockquote>
          </div>
          <p className="flex flex-wrap items-center gap-2 text-small">
            <LegalLink slug={consent.slug} newTabLabel="(opens in a new tab)">
              {displayTitle(consent.title)}, version {consent.version}
            </LegalLink>
            {consent.isDraft ? <StatusBadge status="warning">Draft</StatusBadge> : null}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormButton type="button" variant="secondary" className="w-full" onClick={() => setConfirming(false)}>
              Cancel
            </FormButton>
            <FormButton type="button" onClick={turnOn}>
              Confirm
            </FormButton>
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}
