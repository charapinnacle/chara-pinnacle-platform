import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TextLink } from "@/components/forms/text-link";
import { ContentPage, ContentSection } from "@/components/public/content-page";
import { isReleased } from "@/lib/dal/release";
import { getAvailabilityRules } from "@/lib/dal/workforce-availability";
import { formatCount } from "@/lib/i18n/format";
import { directoryNames, rankingCopy, rankingFilters, suggestionCopy, suggestionCriterionTexts } from "@/lib/partners/ranking";
import { RECRUITMENT_DIRECTORY_PATH, STAFFING_DIRECTORY_PATH } from "@/lib/public/navigation";
import { suggestionCriteria } from "@/lib/requirements/suggestions";
import { rankingPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata({ params }: PageProps<"/[lang]/legal/ranking">): Promise<Metadata> {
  const { lang } = await params;
  return (await isReleased("release_partner_directories")) ? rankingPageMetadata(lang) : {};
}

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The main parameters of the order of Find Partners (NFR-C8: P2B Regulation article 5, DSA article 27), written from
// lib/partners/ranking.ts, whose values a unit test holds against public.search_partners and
// public.search_available_workforce (and public.suggest_partners). It describes release 2a, so it exists only while
// release 2a is on; the partner suggestions of release 2b (V36) are described while release 2b is on, and the job order
// board (V79) and Find Workers (V80) add their sections.
export default async function RankingPage({ params }: PageProps<"/[lang]/legal/ranking">) {
  const { lang } = await params;
  if (!(await isReleased("release_partner_directories"))) notFound();
  const [{ staleDays }, suggestions] = await Promise.all([getAvailabilityRules(), isReleased("release_job_orders")]);
  const current = `confirmed by the company within the last ${formatCount(staleDays)} days`;

  return (
    <ContentPage
      title="How search results are ranked"
      lead="What decides the order of the recruitment and staffing companies in the searches of the partner network, and what never does."
    >
      <ContentSection heading="Where this applies">
        <p>This page describes three searches:</p>
        <ul className="grid list-disc gap-1 ps-5">
          <li>
            <TextLink href={`/${lang}/${RECRUITMENT_DIRECTORY_PATH}`}>Find Recruitment Partners</TextLink>, which shows
            recruitment companies.
          </li>
          <li>
            <TextLink href={`/${lang}/${STAFFING_DIRECTORY_PATH}`}>Find Staffing Partners</TextLink>, which shows staffing
            companies and recruitment companies that also offer staffing.
          </li>
          <li>
            The available workforce search on both pages, which employers use to find companies that can supply a number
            of workers.
          </li>
        </ul>
        {suggestions ? (
          <p>It also describes the partners suggested to an employer for a workforce requirement.</p>
        ) : null}
      </ContentSection>

      <ContentSection heading="Which companies are shown">
        <p>A company appears in these searches only when all of the following are true:</p>
        <ul className="grid list-disc gap-1 ps-5">
          <li>its profile has been reviewed and listed;</li>
          <li>its profile has not been declined;</li>
          <li>its account is active, not suspended;</li>
          <li>its profile has not been hidden by moderation.</li>
        </ul>
        <p>
          A company that is not listed, or that is declined, suspended or hidden, never appears, whatever plan it has. An
          availability listing counts only when it was {current}.
        </p>
      </ContentSection>

      <ContentSection heading="Filters that narrow the results">
        <p>{rankingCopy.narrowing}</p>
        <p>Every result matches these filters, so they do not change the order of the results.</p>
      </ContentSection>

      <ContentSection heading="Filters that rank the results">
        <p>
          The other filters never remove a company from the results. Each filter a company matches counts once, and every
          result names the filters it matched.
        </p>
        <ul className="grid gap-2">
          {rankingFilters.map(({ name, label, formLabel, directories, text }) => (
            <li key={name}>
              <span className="font-medium">
                {sentenceCase(label)}
                {formLabel ? ` (${formLabel} in the form)` : ""}:
              </span>{" "}
              {text} <span className="text-muted-foreground">Offered by {directories.map((kind) => directoryNames[kind]).join(" and ")}.</span>
            </li>
          ))}
        </ul>
      </ContentSection>

      <ContentSection heading="The order of the directories">
        <p>Find Recruitment Partners and Find Staffing Partners sort their results by these parameters, in this order:</p>
        <ol className="grid list-decimal gap-2 ps-5">
          <li>The number of filters the company matches, most first.</li>
          <li>
            {rankingCopy.profileTime[0]}
            <ul className="mt-1 grid list-disc gap-1 ps-5">
              {rankingCopy.profileTime.slice(1, -1).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {rankingCopy.profileTime.at(-1)}
          </li>
          <li>{rankingCopy.identifier}</li>
        </ol>
        <p>{rankingCopy.weighting}</p>
      </ContentSection>

      <ContentSection heading="The available workforce search">
        <p>
          An employer enters a destination country, an occupation, a number of workers and a number of days. The search is
          open to signed-in members of an active employer organisation whose plan includes it.
        </p>
        <p>
          It shows the recruitment and staffing companies that serve the destination and whose current availability
          listings of the occupation add up to at least the number of workers within that number of days. A listing adds
          the workers available plus its monthly capacity for the days between the later of today and the date its
          workers are available and the end of the period, counted as the monthly capacity times those days divided by
          30, rounded down. A listing whose workers are available only after the period adds nothing.{" "}
          {rankingCopy.supplyExample}
        </p>
        <p>The results are sorted by these parameters, in this order:</p>
        <ol className="grid list-decimal gap-2 ps-5">
          <li>Companies whose workers available today already cover the number of workers come first.</li>
          <li>The most recent confirmation among the listings that count, most recent first.</li>
          <li>The same fixed random number as above.</li>
        </ol>
        <p>{rankingCopy.tieBreakFirst}</p>
      </ContentSection>

      {suggestions ? (
        <ContentSection heading="Partner suggestions for a workforce requirement">
          <p>{suggestionCopy.selection}</p>
          <p>The criteria:</p>
          <ul className="grid gap-2">
            {suggestionCriteria.map((name) => (
              <li key={name}>
                <span className="font-medium">{sentenceCase(name.replaceAll("_", " "))}:</span> {suggestionCriterionTexts[name]}
              </li>
            ))}
          </ul>
          <p>Suggestions are sorted by these parameters, in this order:</p>
          <ol className="grid list-decimal gap-2 ps-5">
            <li>The number of criteria the company meets, most first.</li>
            <li>The last time the company changed its profile, as for the directories above.</li>
            <li>The same fixed random number as above.</li>
          </ol>
          <p>{suggestionCopy.explain}</p>
          <p>{suggestionCopy.limit}</p>
        </ContentSection>
      ) : null}

      <ContentSection heading="Advanced filters">
        <p>
          {rankingCopy.advanced} See <TextLink href={`/${lang}/pricing`}>Pricing</TextLink>. They work like every other
          ranking filter: a match adds to the number of matched filters, and they never remove a company from the
          results.
        </p>
        <p>
          A search with advanced filters by someone whose plan does not include them is not run; the directory says so and
          offers the search without them.
        </p>
      </ContentSection>

      <ContentSection heading="What never changes the order">
        <ul className="grid list-disc gap-2 ps-5">
          <li>
            Payment: whether a company pays, which plan it is on and how much it pays are not read by any of these
            searches. No company can pay to appear higher.
          </li>
          <li>
            The plan of the person searching: it decides only which filters and searches they can use, never the order of
            the results.
          </li>
          <li>Size: {rankingCopy.size}</li>
          <li>Paging and limits: {rankingCopy.paging}</li>
        </ul>
      </ContentSection>

      <ContentSection heading="Questions">
        <p>
          If you have a question about the order of results, or think a result breaks these rules,{" "}
          <TextLink href={`/${lang}/contact`}>contact us</TextLink>.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
