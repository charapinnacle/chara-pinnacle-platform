"use client";

import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { confirmListing } from "@/lib/actions/workforce-availability";
import type { WorkforceListing } from "@/lib/dal/workforce-availability";

type ConfirmListingProps = { slug: string; listing: WorkforceListing; name: string; onConfirmed: () => void };

// Confirm of one availability listing (FR-K3), shared by the workforce profile and the partner dashboard. A file of its
// own, so the dashboard does not load the listing form and its validation.
export function ConfirmListing({ slug, listing, name, onConfirmed }: ConfirmListingProps) {
  const confirm = useActionCall("Could not confirm the listing");
  return (
    <FormButton
      type="button"
      busy={confirm.pending}
      onClick={() => confirm.run(() => confirmListing(slug, listing.id), `Listing confirmed: ${name}`, onConfirmed)}
    >
      Confirm<span className="sr-only"> the listing for {name}</span>
    </FormButton>
  );
}
