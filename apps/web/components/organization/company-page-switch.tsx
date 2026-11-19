"use client";

import { useId, useState, useTransition } from "react";
import { FormButton } from "@/components/forms/form-button";
import { TextLink } from "@/components/forms/text-link";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast, toastError, toastNetworkError } from "@/components/feedback/toast-store";
import { setCompanyPageVisibility } from "@/lib/actions/company-page";
import { COMPANY_PAGE_DESCRIPTION } from "@/lib/companies/page";
import { isRedirectError } from "@/lib/redirect-error";
import { cn } from "@/lib/utils";

const FAILED = "The company page was not changed";

// pageHref: the address of the public page, linked next to the switch while it is on; left out on the page itself.
type CompanyPageSwitchProps = { slug: string; enabled: boolean; pageHref?: string };

// The visibility switch of the public company page (FR-K5 AC9). Turning it on asks first, because the page is then public;
// turning it off takes effect at once. The switch shows the new state while the call runs and returns to the previous
// one when it fails.
export function CompanyPageSwitch({ slug, enabled: initial, pageHref }: CompanyPageSwitchProps) {
  const [enabled, setEnabled] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const labelId = useId();
  const descriptionId = useId();

  function change(next: boolean) {
    const previous = enabled;
    setConfirming(false);
    setEnabled(next);
    startTransition(async () => {
      try {
        const result = await setCompanyPageVisibility(slug, next);
        if (result.message !== undefined) {
          setEnabled(previous);
          toastError(FAILED, result.message);
          return;
        }
        if (result.enabled) {
          toast({ title: "Your company page is live", link: { href: result.href, label: "View your company page" } });
        } else {
          toast({ title: "Your company page is off", description: "Vacancy pages show your company name without a link." });
        }
      } catch (error) {
        if (isRedirectError(error)) return;
        setEnabled(previous);
        toastNetworkError(FAILED);
      }
    });
  }

  return (
    <div className="flex items-start justify-between gap-6">
      <div className="grid gap-1">
        <span id={labelId} className="font-medium">
          Public company page
        </span>
        <p id={descriptionId} className="text-small text-muted-foreground">
          {COMPANY_PAGE_DESCRIPTION}
        </p>
        {enabled && pageHref ? (
          <TextLink standalone href={pageHref}>
            View your company page
          </TextLink>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        aria-disabled={pending}
        onClick={() => {
          if (pending) return;
          if (enabled) change(false);
          else setConfirming(true);
        }}
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors aria-disabled:cursor-progress",
          enabled ? "bg-primary" : "bg-muted-foreground",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-block size-6 rounded-full bg-card shadow-sm transition-transform",
            enabled ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
      <ModalDialog open={confirming} onClose={() => setConfirming(false)} title="Turn on your public company page?">
        <p className="text-body leading-relaxed">{COMPANY_PAGE_DESCRIPTION}</p>
        <p className="text-body leading-relaxed">You can turn it off at any time; the page then disappears at once.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" className="w-full" onClick={() => setConfirming(false)}>
            Cancel
          </FormButton>
          <FormButton type="button" onClick={() => change(true)}>
            Turn on
          </FormButton>
        </div>
      </ModalDialog>
    </div>
  );
}
