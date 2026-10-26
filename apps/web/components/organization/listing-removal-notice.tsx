"use client";

import { use } from "react";
import { Notice } from "@/components/forms/notice";
import { listingRemovalWarning } from "@/lib/validation/workforce-availability";

type ListingRemovalNoticeProps = {
  counts: Promise<Readonly<Record<string, number>>>;
  saved: readonly string[];
  current: readonly string[];
  nameOf: (code: string) => string;
};

// Next to Save of a profile form: the availability listings that a removed occupation or source country takes with it
// (FR-K3). The counts stream in after the form, so the page does not wait for them. The live region stays in place so
// that the warning is announced when it appears.
export function ListingRemovalNotice({ counts, saved, current, nameOf }: ListingRemovalNoticeProps) {
  const warning = listingRemovalWarning(saved, current, use(counts), nameOf);
  return (
    <div role="status" className="empty:hidden">
      {warning ? (
        <Notice tone="warning">
          <p>{warning}</p>
        </Notice>
      ) : null}
    </div>
  );
}
