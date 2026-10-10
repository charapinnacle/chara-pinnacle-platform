import Link from "next/link";
import { FormButton } from "@/components/forms/form-button";
import { HeaderMenu } from "@/components/layout/header-menu";
import { LinkButton } from "@/components/layout/link-button";
import { signOut } from "@/lib/actions/login";
import { getCurrentUser } from "@/lib/dal/session";
import { guestLinks, siteLinks } from "@/lib/public/navigation";
import { homePath } from "@/lib/routes";

const linkClassName =
  "inline-flex min-h-11 items-center rounded-lg px-3 text-small font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground";

function GuestItems({ lang }: { lang: string }) {
  return guestLinks.map(({ path, label }) => (
    <li key={path}>
      {path === "signup" ? (
        <LinkButton href={`/${lang}/${path}`} size="default" className="min-h-11 px-4 md:ms-2">
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

// A plain form around the server action instead of LogoutButton: a visitor downloads no log-out code, and it works without
// JavaScript.
async function logOut() {
  "use server";
  await signOut();
}

// A signed-in person is offered the way back to their own area and the way out instead of Log in and Sign up. Not behind a
// Suspense boundary: React streams a finished boundary separately once the page passes about 12.8 kB of HTML, and a
// streamed part stays hidden without JavaScript and appears only after the load event with it.
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
        <form action={logOut}>
          <FormButton type="submit" variant="secondary" className="min-h-11 w-full min-w-0 px-3 text-small md:w-auto">
            Log out
          </FormButton>
        </form>
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
          <AccountItems lang={lang} />
        </ul>
      </nav>
    </HeaderMenu>
  );
}
