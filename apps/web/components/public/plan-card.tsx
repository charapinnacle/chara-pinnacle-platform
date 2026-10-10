import { Check } from "lucide-react";
import { LinkButton } from "@/components/layout/link-button";
import type { Link, PlanCard as PricedPlan } from "@/lib/billing/pricing";
import { cn } from "@/lib/utils";

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="grid gap-2 text-body">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5">
          <Check aria-hidden className="mt-1 size-4 shrink-0 text-brand-ink" strokeWidth={2} />
          {item}
        </li>
      ))}
    </ul>
  );
}

export function PlanCard({ card, link, recommended }: { card: PricedPlan; link: Link | null; recommended: boolean }) {
  const [headline, ...terms] = card.trial;
  return (
    <li
      className={cn(
        "relative flex flex-col gap-6 rounded-2xl border bg-card p-card-xl shadow-card transition-[transform,box-shadow] duration-200 ease-brand hover:-translate-y-0.5 hover:shadow-md",
        recommended && "border-brand ring-1 ring-brand",
      )}
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h2">{card.name}</h3>
          {recommended ? (
            <span className="rounded-full bg-brand-gradient px-2.5 py-0.5 text-caption font-semibold text-inverse">Recommended</span>
          ) : null}
        </div>
        {card.price ? (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-figure tabular-nums">{card.price}</span>
            <span className="text-small text-muted-foreground">{card.per} excl. VAT</span>
          </p>
        ) : (
          <p className="text-muted-foreground">Price on request</p>
        )}
      </div>
      {headline ? (
        <div className="grid gap-1 rounded-xl bg-accent/60 p-card text-small">
          <p className="font-semibold text-accent-foreground">{headline}</p>
          {terms.map((term) => (
            <p key={term} className="text-muted-foreground">
              {term}
            </p>
          ))}
        </div>
      ) : null}
      {card.limits.length > 0 || card.features.length > 0 ? (
        <div className="grid gap-2 border-t pt-6">
          {card.limits.length > 0 ? <Bullets items={card.limits} /> : null}
          {card.features.length > 0 ? <Bullets items={card.features} /> : null}
        </div>
      ) : null}
      {link ? (
        <LinkButton href={link.href} variant={recommended ? "primary" : "secondary"} className="mt-auto w-full whitespace-normal">
          {link.label}
        </LinkButton>
      ) : null}
    </li>
  );
}
