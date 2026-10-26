import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { DetailList } from "@/components/layout/detail-list";
import { PageHeader } from "@/components/layout/page-header";
import type { CompanyPage, CompanyVacancy } from "@/lib/companies/page";
import { formatDate } from "@/lib/i18n/format";
import { formatSalary, publicWebsite } from "@/lib/jobs/presentation";
import { cn } from "@/lib/utils";
import { employmentTypeLabels } from "@/lib/validation/job";

type CompanyPageViewProps = {
  lang: string;
  page: CompanyPage;
  // The viewer's actions (FR-K5 AC8); the page that knows the viewer decides.
  actions?: React.ReactNode;
};

function VacancyRow({ lang, vacancy }: { lang: string; vacancy: CompanyVacancy }) {
  const salary = formatSalary(vacancy);
  return (
    <li className="grid gap-1 py-5">
      <h3 className="text-h3">
        <TextLink href={`/${lang}/jobs/${vacancy.id}`} className="break-words">
          {vacancy.title}
        </TextLink>
      </h3>
      <p className="text-body break-words text-muted-foreground">
        {vacancy.city}, {vacancy.country} · {employmentTypeLabels[vacancy.employmentType]}
      </p>
      <p className="text-body">
        {salary ? <span className="tabular-nums">{salary} · </span> : null}
        <span className="text-muted-foreground">
          Posted <time dateTime={vacancy.publishedAt}>{formatDate(vacancy.publishedAt)}</time>
        </span>
      </p>
    </li>
  );
}

// The public company page of an employer (FR-K5, spec section 17): the company's own details and its open vacancies, never
// the legal name, members, contact details or the plan (DATA_MODEL.md section 10). Named job orders join it with release
// 2b (V54).
export function CompanyPageView({ lang, page, actions }: CompanyPageViewProps) {
  const website = publicWebsite(page.website);
  const details = [
    { label: "Based in", value: page.basedIn.name },
    ...(page.industry ? [{ label: "Industry", value: page.industry.name }] : []),
    ...(website
      ? [
          {
            label: "Website",
            value: (
              <TextLink href={website.href} target="_blank" rel="nofollow noopener noreferrer" prefetch={false} className="break-all">
                {website.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </TextLink>
            ),
          },
        ]
      : []),
  ];
  const shown = page.vacancies.length;

  return (
    <div className="@container">
      <article className={cn("grid gap-8", actions && "@4xl:grid-cols-[minmax(0,1fr)_20rem] @4xl:gap-x-12")}>
        <PageHeader title={page.displayName} className="animate-rise gap-3 @4xl:col-start-1">
          <p className="text-body break-words text-muted-foreground">
            {[page.industry?.name, `Based in ${page.basedIn.name}`].filter(Boolean).join(" · ")}
          </p>
        </PageHeader>

        {actions ? (
          <div className="@4xl:col-start-2 @4xl:row-span-2 @4xl:row-start-1">
            <Card elevated padding="lg" className="animate-rise gap-4 @4xl:sticky @4xl:top-8">
              {actions}
            </Card>
          </div>
        ) : null}

        <div className="grid content-start gap-10 @4xl:col-start-1">
          <section aria-labelledby="company-about-heading" className="grid gap-3">
            <h2 id="company-about-heading" className="text-h2">
              About the company
            </h2>
            {page.description ? (
              <p className="max-w-[65ch] leading-7 break-words whitespace-pre-line">{page.description}</p>
            ) : null}
            <DetailList items={details} />
          </section>

          <section aria-labelledby="company-vacancies-heading" className="grid gap-3">
            <h2 id="company-vacancies-heading" className="text-h2">
              Open vacancies
            </h2>
            {shown === 0 ? (
              <EmptyState title="No open vacancies right now" description="Check back soon." />
            ) : (
              <>
                {page.openVacancyCount > shown ? (
                  <p className="text-body text-muted-foreground">
                    The {shown} newest of {page.openVacancyCount} open vacancies.
                  </p>
                ) : null}
                <ul className="divide-y border-y">
                  {page.vacancies.map((vacancy) => (
                    <VacancyRow key={vacancy.id} lang={lang} vacancy={vacancy} />
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </article>
    </div>
  );
}
