import { TextLink } from "@/components/forms/text-link";
import type { Link, PlanCard as Card } from "@/lib/billing/pricing";

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="grid list-disc gap-1 ps-5 marker:text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function PlanCard({ card, link }: { card: Card; link: Link | null }) {
  const [headline, ...terms] = card.trial;
  return (
    <li className="grid content-start gap-3 rounded-xl border bg-card p-4">
      <h3 className="text-lg font-semibold">{card.name}</h3>
      {card.price ? (
        <p>
          <span className="text-2xl font-semibold">{card.price}</span>{" "}
          <span className="text-muted-foreground">{card.per} excl. VAT</span>
        </p>
      ) : (
        <p className="text-muted-foreground">Price on request</p>
      )}
      {headline ? (
        <div className="grid gap-1 text-body">
          <p className="font-medium">{headline}</p>
          {terms.map((term) => (
            <p key={term} className="text-muted-foreground">
              {term}
            </p>
          ))}
        </div>
      ) : null}
      {card.limits.length > 0 ? <Bullets items={card.limits} /> : null}
      {card.features.length > 0 ? <Bullets items={card.features} /> : null}
      {link ? (
        <TextLink standalone href={link.href}>
          {link.label}
        </TextLink>
      ) : null}
    </li>
  );
}
