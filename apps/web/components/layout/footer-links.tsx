import Link from "next/link";
import { publicFooterColumns } from "@/lib/public/navigation";

// Not prefetched: a page of its own is rarely wanted, and ten prefetches follow every action. Every target is 44 px high
// on a phone and under a coarse pointer; with a mouse the rows are closer from sm.
const linkClassName =
  "inline-flex min-h-11 items-center rounded-sm underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline sm:min-h-8 sm:pointer-coarse:min-h-11";

export function FooterLinks({ lang, label, links }: { lang: string; label: string; links: readonly { path: string; label: string }[] }) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-x-5">
        {links.map(({ path, label: text }) => (
          <li key={path}>
            <Link href={`/${lang}/${path}`} prefetch={false} className={linkClassName}>
              {text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// The titles of the columns are not headings, so the footer adds nothing to the outline of a page.
export function FooterColumns({ lang }: { lang: string }) {
  return (
    <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3 lg:gap-x-14">
      {publicFooterColumns.map(({ title, links }) => (
        <div key={title} className="grid content-start gap-2 last:max-sm:col-span-2">
          <p id={`footer-${title.toLowerCase()}`} className="text-eyebrow text-brand uppercase">
            {title}
          </p>
          <ul aria-labelledby={`footer-${title.toLowerCase()}`}>
            {links.map(({ path, label }) => (
              <li key={path}>
                <Link href={`/${lang}/${path}`} prefetch={false} className={linkClassName}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
