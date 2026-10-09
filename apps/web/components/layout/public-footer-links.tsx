import Link from "next/link";
import { footerLinks } from "@/lib/public/navigation";

export function PublicFooterLinks({ lang }: { lang: string }) {
  return (
    <nav aria-label="Legal">
      <ul className="flex flex-wrap gap-x-5">
        {footerLinks.map(({ path, label }) => (
          <li key={path}>
            <Link
              href={`/${lang}/${path}`}
              className="inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 hover:text-foreground"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
