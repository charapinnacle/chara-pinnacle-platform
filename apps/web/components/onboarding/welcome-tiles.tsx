import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Tile = { href: string; title: string; text: string };

// The next actions after onboarding as large tiles; the first is the primary one and is drawn as the dark button is.
export function WelcomeTiles({ tiles }: { tiles: readonly Tile[] }) {
  return (
    <ul className="grid gap-3">
      {tiles.map(({ href, title, text }, index) => (
        <li key={href}>
          <Link
            href={href}
            className={cn(
              "group flex min-h-20 items-center gap-4 rounded-control border px-5 py-4 transition-colors duration-150",
              index === 0
                ? "border-primary bg-primary text-primary-foreground hover:bg-primary-hover"
                : "bg-card hover:border-foreground/40 hover:bg-secondary",
            )}
          >
            <span className="grid flex-1 gap-0.5">
              <span className="text-body font-semibold">{title}</span>
              <span className={cn("text-small", index === 0 ? "text-primary-foreground/80" : "text-muted-foreground")}>{text}</span>
            </span>
            <ArrowRight
              aria-hidden
              className="size-5 shrink-0 transition-transform duration-200 ease-brand group-hover:translate-x-0.5"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
