"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Database } from "@chara-pinnacle/db-types";
import { EMPLOYERS_PATH, forAccountKind, headerLinks, jobSeekersLink } from "@/lib/public/navigation";

// The For employers page is the employer's side of the site: its header offers the way back to the job seekers' side
// instead of Find Jobs and For employers.
export function AudienceLinks({
  lang,
  accountKind,
  className,
}: {
  lang: string;
  accountKind: Database["public"]["Enums"]["account_kind"] | null | undefined;
  className: string;
}) {
  const onEmployers = usePathname() === `/${lang}/${EMPLOYERS_PATH}`;
  const links: readonly { path: string; label: string }[] = onEmployers ? [jobSeekersLink] : headerLinks;
  return forAccountKind(links, accountKind).map(
({ path, label }) => (
    <li key={label} className="max-md:hidden">
      <Link href={path ? `/${lang}/${path}` : `/${lang}`} className={className}>
        {label}
      </Link>
    </li>
  ));
}
