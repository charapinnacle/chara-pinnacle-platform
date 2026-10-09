import Link from "next/link";
import { HeaderMenu } from "@/components/layout/header-menu";
import { headerLinks } from "@/lib/public/navigation";
import { cn } from "@/lib/utils";

const linkClassName =
  "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium hover:bg-accent";

export function PublicNav({ lang }: { lang: string }) {
  return (
    <HeaderMenu>
      <nav aria-label="Main">
        <ul className="flex flex-col md:flex-row md:items-center md:gap-1">
          {headerLinks.map(({ path, label }) => (
            <li key={path}>
              <Link
                href={`/${lang}/${path}`}
                className={cn(
                  linkClassName,
                  path === "signup" && "bg-primary text-primary-foreground hover:bg-primary-hover",
                )}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </HeaderMenu>
  );
}
