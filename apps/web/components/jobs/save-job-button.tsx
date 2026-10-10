"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { useState } from "react";
import { FormButton } from "@/components/forms/form-button";
import { useActionCall } from "@/components/feedback/use-action-call";
import { setSavedJob } from "@/lib/actions/saved-jobs";

type SaveJobButtonProps = { jobId: string; title: string; saved: boolean };

// Not disabled while a call runs: a disabled button loses the focus of a keyboard user, so a press that arrives
// meanwhile is ignored. The state changes only once the database has confirmed it.
export function SaveJobButton({ jobId, title, saved: initiallySaved }: SaveJobButtonProps) {
  const [saved, setSaved] = useState(initiallySaved);
  const { pending, run } = useActionCall("Your saved vacancies were not changed");

  function toggle() {
    if (pending) return;
    const next = !saved;
    run(
      async () => {
        const result = await setSavedJob(jobId, next);
        if (!result.message) setSaved(next);
        return result;
      },
      next ? "Vacancy saved" : "Vacancy removed from your saved list",
    );
  }

  const Icon = saved ? BookmarkCheck : Bookmark;
  return (
    <FormButton
      type="button"
      variant="secondary"
      className="w-auto"
      aria-busy={pending || undefined}
      aria-pressed={saved}
      aria-label={`Save vacancy: ${title}`}
      onClick={toggle}
    >
      <Icon aria-hidden className="size-4" />
      {saved ? "Saved" : "Save"}
    </FormButton>
  );
}
