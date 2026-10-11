import { FormButton } from "@/components/forms/form-button";
import { LinkButton } from "@/components/layout/link-button";
import { requireLogin } from "@/lib/actions/vacancy";
import type { Viewer } from "@/lib/jobs/viewer";
import { applyPath } from "@/lib/routes";

type ApplyButtonProps = {
  jobId: string;
  title: string;
  lang: string;
  viewer: Exclude<Viewer, "company">;
  next: string;
  variant?: "primary" | "secondary";
  label?: string;
};

// A candidate goes to the apply form; a visitor is sent to log in and comes back to it. The accessible name carries the
// title, so that the buttons of a list of results differ.
export function ApplyButton({ jobId, title, lang, viewer, next, variant, label = "Apply now" }: ApplyButtonProps) {
  const name = `${label}: ${title}`;
  if (viewer === "candidate") {
    return (
      <LinkButton href={applyPath(lang, jobId)} variant={variant} aria-label={name}>
        {label}
      </LinkButton>
    );
  }
  return (
    <form action={requireLogin.bind(null, "apply", jobId, next)}>
      <FormButton variant={variant} aria-label={name} className="w-auto">
        {label}
      </FormButton>
    </form>
  );
}
