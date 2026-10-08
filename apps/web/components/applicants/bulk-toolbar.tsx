"use client";

import dynamic from "next/dynamic";
import type { BulkToolbarProps } from "@/components/applicants/bulk-toolbar-form";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";

// The form (React Hook Form, the resolver and the schema) is fetched after the page, not with it: the list and the board
// are readable before the toolbar is.
const BulkToolbarForm = dynamic(() => import("@/components/applicants/bulk-toolbar-form").then((module) => module.BulkToolbarForm), {
  ssr: false,
  loading: () => <LoadingSkeleton rows={2} />,
});

export function BulkToolbar(props: BulkToolbarProps) {
  return <BulkToolbarForm {...props} />;
}
