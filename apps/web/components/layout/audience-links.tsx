"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EMPLOYERS_PATH, headerLinks, jobSeekersLink } from "@/lib/public/navigation";

// The For employers page is the employer's side of the site: its header offers the way back to the job seekers' side
// instead of Find Jobs and For employers.
export function AudienceLinks({ lang, className }: { lang: string; className: string }) {
  const onEmployers = usePathname() === `/${lang}/${EMPLOYERS_PATH}`;
  const links = onEmployers ? [jobSeekersLink] : headerLinks;
  return links.map(({ path, label }) => (
    <li key={label} className="max-md:hidden">
      <Link href={path ? `/${lang}/${path}` : `/${lang}`} className={className}>
        {label}
      </Link>
    </li>
  ));
}
