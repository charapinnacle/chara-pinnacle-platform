import { Check } from "lucide-react";
import { BrandMark, Wordmark } from "@/components/layout/brand";

const points = [
  "Workers keep one passport and apply in a few steps.",
  "Employers publish vacancies and review applicants in one pipeline.",
  "Your documents stay private until you choose to share them.",
];

// The dark half of the sign-in pages from 1024 px: the monogram on its own black, and what CHARA is, in three lines.
export function AuthBrandPanel() {
  return (
    <div className="hidden min-h-[34rem] flex-col justify-between rounded-2xl bg-inverse p-10 text-inverse-muted shadow-card lg:flex">
      <span className="inline-flex items-center gap-4">
        <BrandMark size="lg" />
        <Wordmark subline tone="inverse" />
      </span>
      <div className="grid gap-6">
        <p className="text-display text-balance text-inverse-foreground">The global workforce network.</p>
        <ul className="grid gap-3 text-body">
          {points.map((point) => (
            <li key={point} className="flex gap-3">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={2} />
              {point}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-small">Workers never pay. Every time an employer opens one of your documents, you can see it.</p>
    </div>
  );
}
