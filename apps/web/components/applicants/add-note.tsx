"use client";

import dynamic from "next/dynamic";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";

// The form (React Hook Form, the resolver and the schema) is fetched after the page, not with it.
export const AddNote = dynamic(() => import("@/components/applicants/note-form").then((module) => module.NoteForm), {
  ssr: false,
  loading: () => <LoadingSkeleton rows={1} />,
});
