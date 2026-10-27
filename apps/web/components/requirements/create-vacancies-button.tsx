"use client";

import { useState } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { createRequirementVacancies } from "@/lib/actions/requirements";
import { draftVacanciesText, moreVacanciesText } from "@/lib/requirements/vacancies";
import type { RequirementTarget } from "@/lib/validation/requirement-status";

type CreateVacanciesButtonProps = { slug: string; target: RequirementTarget; linked: number; occupations: number };

const LABEL = "Create vacancies for direct applications";

// Copies the open requirement into one draft vacancy per occupation (FR-M1 AC10). When vacancies were copied before, a
// dialog asks first, since every call adds further drafts.
export function CreateVacanciesButton({ slug, target, linked, occupations }: CreateVacanciesButtonProps) {
  const [asking, setAsking] = useState(false);
  const call = useActionCall("The vacancies were not created");
  const close = () => setAsking(false);

  function create() {
    call.run(() => createRequirementVacancies(slug, target), `${draftVacanciesText(occupations)} created. Check and publish each one.`, close);
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
