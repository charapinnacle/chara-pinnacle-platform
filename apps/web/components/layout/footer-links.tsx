import { cva } from "class-variance-authority";
import Link from "next/link";
import { footerGroups } from "@/lib/public/navigation";

const titleVariants = cva("font-medium", {
  variants: { tone: { default: "text-foreground", inverse: "text-inverse-foreground" } },
});

export const footerLinkVariants = cva(
  "inline-flex min-h-11 items-center rounded-sm underline-offset-4 transition-colors duration-150 hover:underline sm:min-h-8",
  { variants: { tone: { default: "underline hover:text-foreground", inverse: "hover:text-inverse-foreground" } } },
);

type Tone = "default" | "inverse";

export function FooterGroup({ title, tone, children }: { title: string; tone: Tone; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-2">
      <p className={titleVariants({ tone })}>{title}</p>
      <ul>{children}</ul>
    </div>
  );
}

// The Imprint and the legal pages in three short lists side by side (one below the other on a phone), shown in the
// footer of every area, not prefetched (a page of its own is rarely wanted, and eleven prefetches follow every action); a
// page can leave a link out (the area of a candidate has none about billing). On the dark footer the links are plain
// text that underlines on hover; on the light one they are underlined.
export function FooterLinks({ lang, hidePaths = [], tone = "default" }: { lang: string; hidePaths?: readonly string[]; tone?: Tone }) {
  return (
    <nav aria-label="Legal" className="grid gap-x-8 gap-y-6 sm:grid-cols-3">
      {footerGroups.map(({ title, links }) => (
        <FooterGroup key={title} title={title} tone={tone}>
          {links
            .filter(({ path }) => !hidePaths.includes(path))
            .map(({ path, label }) => (
              <li key={path}>
                <Link href={`/${lang}/${path}`} prefetch={false} className={footerLinkVariants({ tone })}>
                  {label}
                </Link>
              </li>
            ))}
        </FooterGroup>
      ))}
    </nav>
  );
}
