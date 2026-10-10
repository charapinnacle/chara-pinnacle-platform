import { BriefcaseBusiness, LockKeyhole, UserRound } from "lucide-react";
import { BrandMark, Wordmark } from "@/components/layout/brand";

const points = [
  { icon: UserRound, text: "Workers keep one passport and apply in a few steps." },
  { icon: BriefcaseBusiness, text: "Employers publish vacancies and review applicants in one pipeline." },
  { icon: LockKeyhole, text: "Your documents stay private until you choose to share them." },
] as const;

// The dark half of the sign-in pages from 1024 px: the monogram on its own black, and what CHARA is, in three lines. It
// stays in view beside a long form, under a gold rule that stops short of the corners.
export function AuthBrandPanel() {
  return (
    <div className="relative hidden min-h-[34rem] flex-col justify-between rounded-2xl bg-inverse p-10 text-inverse-muted shadow-card lg:sticky lg:top-8 lg:flex">
      <span aria-hidden className="absolute inset-x-10 top-0 h-0.5 rounded-b-full bg-brand-gradient" />
      <span className="inline-flex items-center gap-4">
        <BrandMark size="lg" />
        <Wordmark subline tone="inverse" />
      </span>
      <div className="grid gap-8">
        <p className="text-display text-balance text-inverse-foreground">The global workforce network.</p>
        <ul className="grid animate-stagger gap-4 text-body">
          {points.map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-3">
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-inverse-foreground/10">
                <Icon className="size-4 text-brand" strokeWidth={1.75} />
              </span>
              <span className="pt-1">{text}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-small">Workers never pay. Every time an employer opens one of your documents, you can see it.</p>
    </div>
  );
}
