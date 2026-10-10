import Link from "next/link";
import { footerGroups } from "@/lib/public/navigation";

// The Imprint and the legal pages in three short lists side by side (one below the other on a phone), shown in the
// footer of every area.
export function FooterLinks({ lang }: { lang: string }) {
  return (
    <nav aria-label="Legal" className="grid gap-x-8 gap-y-2 sm:grid-cols-3">
      {footerGroups.map(({ title, links }) => (
        <div key={title}>
          <p className="font-medium text-foreground">{title}</p>
          <ul>
            {links.map(({ path, label }) => (
              <li key={path}>
                <Link
                  href={`/${lang}/${path}`}
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
