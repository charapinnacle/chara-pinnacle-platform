import Link from "next/link";
import { Suspense } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { HeaderMenu } from "@/components/layout/header-menu";
import { LinkButton } from "@/components/layout/link-button";
import { getCurrentUser } from "@/lib/dal/session";
import { guestLinks, siteLinks } from "@/lib/public/navigation";
import { homePath } from "@/lib/routes";

const linkClassName =
  "inline-flex min-h-11 items-center rounded-lg px-3 text-small font-medium hover:bg-accent";

function GuestItems({ lang }: { lang: string }) {
  return guestLinks.map(({ path, label }) => (
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
  ));
}

// A signed-in person is offered the way back to their own area and the way out instead of Log in and Sign up.
async function AccountItems({ lang }: { lang: string }) {
  const user = await getCurrentUser();
  if (!user) return <GuestItems lang={lang} />;
  return (
    <>
      <li>
        <Link href={homePath(lang, user.accountKind)} className={linkClassName}>
          Go to my area
        </Link>
      </li>
      <li>
        <LogoutButton className="min-h-11 w-full min-w-0 px-3 md:w-auto" />
      </li>
    </>
  );
}

export function PublicNav({ lang }: { lang: string }) {
  return (
    <HeaderMenu>
      <nav aria-label="Main">
        <ul className="flex flex-col md:flex-row md:items-center md:gap-1">
          {siteLinks.map(({ path, label }) => (
            <li key={path}>
              <Link href={`/${lang}/${path}`} className={linkClassName}>
                {label}
              </Link>
            </li>
          ))}
          <Suspense fallback={<GuestItems lang={lang} />}>
            <AccountItems lang={lang} />
          </Suspense>
        </ul>
      </nav>
    </HeaderMenu>
  );
}
