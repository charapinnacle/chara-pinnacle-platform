import Link from "next/link";
import { footerGroups } from "@/lib/public/navigation";

// The Imprint and the legal pages in three short lists side by side (one below the other on a phone), shown in the
// footer of every area, not prefetched (a page of its own is rarely wanted, and eleven prefetches follow every action); a page can leave a link out (the area of a candidate has none about billing).
export function FooterLinks({ lang, hidePaths = [] }: { lang: string; hidePaths?: readonly string[] }) {
  return (
    <nav aria-label="Legal" className="grid gap-x-8 gap-y-2 sm:grid-cols-3">
      {footerGroups.map(({ title, links }) => (
        <div key={title}>
          <p className="font-medium text-foreground">{title}</p>
          <ul>
            {links.filter(({ path }) => !hidePaths.includes(path)).map(({ path, label }) => (
              <li key={path}>
                <Link
                  href={`/${lang}/${path}`}
                  prefetch={false}
                  className="inline-flex min-h-11 items-center rounded-sm underline sm:min-h-8 underline-offset-4 hover:text-foreground"
                >
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
