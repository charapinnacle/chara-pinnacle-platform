import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { FormButton } from "@/components/forms/form-button";
import { AudienceLinks } from "@/components/layout/audience-links";
import { LinkButton } from "@/components/layout/link-button";
import { SiteMenu } from "@/components/layout/site-menu";
import { signOut } from "@/lib/actions/login";
import { getPostJobHref } from "@/lib/dal/organizations";
import { getCurrentUser } from "@/lib/dal/session";
import { guestLinks, howItWorksLink, laterPhaseFeatures, menuLinks } from "@/lib/public/navigation";
import { homePath } from "@/lib/routes";
import { cn } from "@/lib/utils";

const linkClassName =
  "inline-flex min-h-11 items-center rounded-lg px-3 text-small capitalize font-medium text-foreground transition-colors duration-150 hover:bg-secondary";

const groupTitleClassName = "mb-1.5 text-eyebrow text-muted-foreground uppercase";

const [signIn, signUp] = guestLinks;

// A plain form around the server action instead of LogoutButton: a visitor downloads no log-out code, and it works without
// JavaScript.
async function logOut() {
  "use server";
  await signOut();
}

function LogOut({ className, buttonClassName }: { className?: string; buttonClassName?: string }) {
  return (
    <form action={logOut} className={className}>
      <FormButton type="submit" variant="secondary" className={cn("min-h-11 w-full min-w-0 px-3 text-small", buttonClassName)}>
        Log out
      </FormButton>
    </form>
  );
}

// The account items of the header: Sign in for a visitor (the login page links to the sign-up), the way back to their own
// area for a signed-in person, with Log out from 768 px (in the menu on a phone). Not behind a Suspense boundary: React
// streams a finished boundary separately once the page passes about 12.8 kB of HTML, and a streamed part stays hidden
// without JavaScript and appears only after the load event with it.
function AccountItems({ lang, area }: { lang: string; area: string | null }) {
  if (!area) {
    return (
      <li>
        <Link href={`/${lang}/${signIn.path}`} className={linkClassName}>
          {signIn.label}
        </Link>
      </li>
    );
  }
  return (
    <>
      <li className="max-xs:hidden">
        <Link href={area} className={linkClassName}>
          Go to my area
        </Link>
      </li>
      <li className="max-md:hidden">
        <LogOut />
      </li>
    </>
  );
}

// Pinned to the foot of the panel, so the account actions stay in reach however long the lists above grow.
function MenuActions({ lang, area, postJobHref }: { lang: string; area: string | null; postJobHref: string | null }) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-auto grid grid-cols-2 gap-2.5 border-t bg-background px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {postJobHref ? (
        <LinkButton href={postJobHref} className="col-span-2 xs:hidden">
          Post a job
        </LinkButton>
      ) : null}
      {area ? (
        <>
          <LinkButton href={area} variant="secondary" className="min-h-12">
            Go to my area
          </LinkButton>
          <LogOut className="grid" buttonClassName="min-h-12 text-base" />
        </>
      ) : (
        <>
          <LinkButton href={`/${lang}/${signIn.path}`} variant="secondary" className="min-h-12">
            {signIn.label}
          </LinkButton>
          <LinkButton href={`/${lang}/${signUp.path}`}>{signUp.label}</LinkButton>
        </>
      )}
    </div>
  );
}

// The public header (OPEN_QUESTIONS.md D90): from 768 px the links, Post a job and Sign in, with How it works from 1024 px,
// and no Menu. Below 768 px only the logo, Post a job, Sign in and Menu stay, and Menu opens the panel with everything a
// visitor can explore, the client's later-phase navigation as plain text, and the account actions; below 420 px Post a job
// moves into the panel.
export async function PublicNav({ lang }: { lang: string }) {
  const [user, postJobHref] = await Promise.all([getCurrentUser(), getPostJobHref(lang)]);
  const area = user ? homePath(lang, user.accountKind) : null;
  return (
    <div className="flex items-center gap-1">
      <nav aria-label="Main">
        <ul className="flex items-center gap-1">
          <AudienceLinks lang={lang} className={linkClassName} />
          <li className="max-lg:hidden">
            <Link href={`/${lang}/${howItWorksLink.path}`} className={linkClassName}>
              {howItWorksLink.label}
            </Link>
          </li>
          {postJobHref ? (
            <li className="max-xs:hidden">
              <LinkButton href={postJobHref} size="default" className="min-h-11 px-4 md:mx-1">
                Post a job
              </LinkButton>
            </li>
          ) : null}
          <AccountItems lang={lang} area={area} />
        </ul>
      </nav>
      <SiteMenu homeHref={`/${lang}`}>
        <nav aria-labelledby="menu-explore" className="pt-6 pb-2">
          <p id="menu-explore" className={groupTitleClassName}>
            Explore
          </p>
          <ul className="divide-y">
            {menuLinks.map(({ path, label }) => (
              <li key={label}>
                <Link
                  href={path ? `/${lang}/${path}` : `/${lang}`}
                  className="flex min-h-13 items-center justify-between gap-3 text-lead font-medium transition-colors duration-150 hover:text-brand-ink"
                >
                  {label}
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="pt-6 pb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p id="menu-later" className={cn(groupTitleClassName, "mb-0")}>
              Coming in a later phase
            </p>
            <span className="shrink-0 rounded-full border px-2.5 py-0.5 text-caption font-medium text-muted-foreground">Not yet available</span>
          </div>
          <ul aria-labelledby="menu-later" className="flex flex-wrap gap-2">
            {laterPhaseFeatures.map((feature) => (
              <li key={feature} className="rounded-lg bg-secondary px-3 py-1.5 text-small text-muted-foreground">
                {feature}
              </li>
            ))}
          </ul>
        </div>
        <MenuActions lang={lang} area={area} postJobHref={postJobHref} />
      </SiteMenu>
    </div>
  );
}
