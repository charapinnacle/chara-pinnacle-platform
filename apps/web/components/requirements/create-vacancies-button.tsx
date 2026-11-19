"use client";

import { useRef, useState } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast } from "@/components/feedback/toast-store";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { createRequirementVacancies } from "@/lib/actions/requirements";
import { draftVacanciesText, moreVacanciesText } from "@/lib/requirements/vacancies";
import type { RequirementTarget } from "@/lib/validation/requirement-status-input";

type CreateVacanciesButtonProps = { slug: string; target: RequirementTarget; linked: number; occupations: number };

const LABEL = "Create vacancies for direct applications";

// Copies the open requirement into one draft vacancy per occupation (FR-M1 AC10). When vacancies were copied before, a
// dialog asks first, since every call adds further drafts; the call names the number of linked vacancies the page
// showed, so a confirmation for an older list is refused. The success toast counts what the database created.
export function CreateVacanciesButton({ slug, target, linked, occupations }: CreateVacanciesButtonProps) {
  const [asking, setAsking] = useState(false);
  const created = useRef<number | null>(null);
  const call = useActionCall("The vacancies were not created");
  const close = () => setAsking(false);

  function create() {
    created.current = null;
    call.run(
      async () => {
        const result = await createRequirementVacancies(slug, target, linked);
        if (result.created === undefined) return result;
        created.current = result.created;
        return { silent: true };
      },
      "",
      () => {
        close();
        if (created.current !== null) toast({ title: `${draftVacanciesText(created.current)} created. Check and publish each one.` });
      },
    );
  }

  return (
    <>
      <FormButton
        type="button"
        className="w-auto"
        busy={call.pending && !asking}
        disabled={call.pending}
        onClick={linked > 0 ? () => setAsking(true) : create}
      >
        {LABEL}
      </FormButton>
      <ModalDialog open={asking} onClose={close} title="Create more vacancies?">
        <p className="text-body leading-relaxed">{moreVacanciesText(linked, occupations)}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" className="w-full" onClick={close}>
            Cancel
          </FormButton>
          <FormButton type="button" busy={call.pending} onClick={create}>
            Create vacancies
          </FormButton>
        </div>
      </ModalDialog>
    </>
  );
}
