import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { formatDate } from "@/lib/i18n/format";
import type { Passport } from "@/lib/dal/passport";

type AvailabilityCardProps = { lang: string; availability: Passport["availability"]; availableFrom: Passport["availableFrom"] };

function availabilityText({ availability, availableFrom }: Pick<AvailabilityCardProps, "availability" | "availableFrom">): string {
  if (availability === "now") return "Available now";
  if (availability === "from_date" && availableFrom) return `Available from ${formatDate(availableFrom)}`;
  if (availability === "unavailable") return "Not available";
  return "Not set";
}

// What employers read of the passport about when the worker can start, and the way to change it.
export function AvailabilityCard({ lang, availability, availableFrom }: AvailabilityCardProps) {
  return (
    <Card as="section" aria-labelledby="availability-heading" padding="lg" elevated className="content-start gap-3">
      <h2 id="availability-heading" className="text-h2">
        Availability
      </h2>
      <p className="text-body">{availabilityText({ availability, availableFrom })}</p>
      <TextLink standalone="flush" href={`/${lang}/passport#experience`} className="text-small">
        {availability ? "Change availability" : "Set availability"}
      </TextLink>
    </Card>
  );
}
