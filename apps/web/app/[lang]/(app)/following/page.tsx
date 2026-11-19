import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ConnectionList } from "@/components/connections/connection-list";
import { PageHeader } from "@/components/layout/page-header";
import { FOLLOWING_HEADING_ID, followedCompanyItem } from "@/lib/connections/list";
import { listFollowedCompanies } from "@/lib/dal/connections";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { partnerDirectoryPath } from "@/lib/partners/search-params";
import { followingPath, homePath } from "@/lib/routes";
import { parseListCursor } from "@/lib/validation/job";

export const metadata: Metadata = { title: "Followed companies", robots: { index: false } };

// The companies the signed-in user follows (FR-L4 AC8, AC10), personal to them, newest first. A company that is
// suspended, turned its page off or left the directory is not listed while the follow is kept. Nothing is shown while
// release 2a is off; an account that has not chosen its kind finishes that step first.
export default async function FollowingPage({ params, searchParams }: PageProps<"/[lang]/following">) {
  const [{ lang }, { cursor: rawCursor }] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const user = await requireUser(lang);
  if (user.accountKind === null) redirect(homePath(lang, null));

  const cursor = parseListCursor(rawCursor);
  const { companies, nextCursor } = await listFollowedCompanies(cursor);
  const worker = user.accountKind === "worker";

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Followed companies"
        titleProps={{ id: FOLLOWING_HEADING_ID, tabIndex: -1 }}
        description="The companies you follow, newest first. The companies only see how many people follow them, never who."
      />
      <ConnectionList
        mode={{ kind: "following" }}
        items={companies.map((company) => followedCompanyItem(lang, company))}
        headingId={FOLLOWING_HEADING_ID}
        empty={{
          title: "You do not follow any companies yet",
          description: worker
            ? "Follow a company from its page to hear about its new vacancies."
            : "Follow an employer from its page to hear about its new vacancies, or a partner from its profile to keep it at hand.",
          href: worker ? `/${lang}/jobs` : partnerDirectoryPath(lang, "recruitment"),
          label: worker ? "Find jobs" : "Find Recruitment Partners",
        }}
        nextHref={nextCursor ? followingPath(lang, nextCursor) : null}
        firstHref={cursor ? followingPath(lang) : null}
      />
    </div>
  );
}
