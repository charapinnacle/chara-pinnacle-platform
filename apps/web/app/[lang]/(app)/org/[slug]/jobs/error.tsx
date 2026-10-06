"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";

const TITLE = "The vacancies could not be loaded";

export default function JobsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    toast({ variant: "error", title: TITLE, description: "Check your connection and try again." });
  }, []);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8">
      <EmptyState icon={TriangleAlert} title={TITLE} description="Nothing was changed. Try again in a moment.">
        <FormButton type="button" variant="secondary" onClick={retry}>
          Try again
        </FormButton>
      </EmptyState>
    </div>
  );
}
