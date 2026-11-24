"use client";

import { CircleCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { confirmListing } from "@/lib/actions/workforce-availability";
import type { WorkforceListing } from "@/lib/dal/workforce-availability";

type ConfirmListingProps = { slug: string; listing: WorkforceListing; name: string };

// Confirm of one availability listing (FR-K3), shared by the workforce profile and the partner dashboard. A file of its
// own, so the dashboard does not load the listing form and its validation. Shown only for a listing due for confirmation,
// as a secondary action beside Edit and Delete: the numbers are still right, so it stays visible in search.
export function ConfirmListing({ slug, listing, name }: ConfirmListingProps) {
  const router = useRouter();
  const confirm = useActionCall("Could not confirm the listing");
  return (
    <FormButton
      type="button"
      variant="secondary"
      busy={confirm.pending}
      onClick={() => confirm.run(() => confirmListing(slug, listing.id), `Listing confirmed: ${name}`, () => router.refresh())}
    >
      <CircleCheck aria-hidden className="size-4" />
      Confirm<span className="sr-only normal-case"> the listing for {name}</span>
    </FormButton>
  );
}
