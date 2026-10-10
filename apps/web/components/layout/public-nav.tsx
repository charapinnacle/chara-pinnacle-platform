import Link from "next/link";
import { HeaderMenu } from "@/components/layout/header-menu";
import { LinkButton } from "@/components/layout/link-button";
import { headerLinks } from "@/lib/public/navigation";

const linkClassName =
  "inline-flex min-h-11 items-center rounded-lg px-3 text-small font-medium hover:bg-accent";

export function PublicNav({ lang }: { lang: string }) {
  return (
    <HeaderMenu>
      <nav aria-label="Main">
        <ul className="flex flex-col md:flex-row md:items-center md:gap-1">
          {headerLinks.map(({ path, label }) => (
            <li key={path}>
              {path === "signup" ? (
                <LinkButton href={`/${lang}/${path}`} size="default" className="min-h-11 px-3">
                  {label}
                </LinkButton>
              ) : (
                <Link href={`/${lang}/${path}`} className={linkClassName}>
                  {label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </HeaderMenu>
  );
}
