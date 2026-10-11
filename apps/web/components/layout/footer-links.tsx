import { cva } from "class-variance-authority";
import Link from "next/link";

const footerLinkVariants = cva(
  "inline-flex min-h-11 items-center rounded-sm underline-offset-4 transition-colors duration-150 hover:underline sm:min-h-8",
  { variants: { tone: { default: "hover:text-foreground", inverse: "hover:text-inverse-foreground" } } },
);

type Tone = "default" | "inverse";

// One line of links that wraps, shown in the footer of every area; not prefetched (a page of its own is rarely wanted,
// and ten prefetches follow every action).
export function FooterLinks({
  lang,
  label,
  links,
  tone = "default",
}: {
  lang: string;
  label: string;
  links: readonly { path: string; label: string }[];
  tone?: Tone;
}) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-x-5">
        {links.map(({ path, label: text }) => (
          <li key={path}>
            <Link href={`/${lang}/${path}`} prefetch={false} className={footerLinkVariants({ tone })}>
              {text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
