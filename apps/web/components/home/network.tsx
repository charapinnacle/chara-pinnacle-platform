import { Band } from "@/components/home/band";
import { RecentApplications } from "@/components/dashboard/recent-applications";
import { StageTable } from "@/components/dashboard/stage-table";
import { BRAND_NAME } from "@/lib/brand";
import type { MyApplication } from "@/lib/dal/applications";
import { sumOf, type StageTotals } from "@/lib/dashboard/stage-counts";

const HOUR_MS = 3_600_000;

// Fictional figures and vacancies, never data of the platform.
const employerTotals: StageTotals = { applied: 14, viewed: 9, shortlisted: 6, interview: 3, offer: 1, hired: 2, rejected: 7, withdrawn: 1 };

function workerApplications(now: Date): MyApplication[] {
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * HOUR_MS).toISOString();
  return [
    { id: "home-1", jobTitle: "TIG welder", employerName: "Northwind Shipyard", status: "interview", appliedAt: hoursAgo(240), lastEventAt: hoursAgo(2) },
    { id: "home-2", jobTitle: "Pipe fitter", employerName: "Lakeside Fabrication", status: "shortlisted", appliedAt: hoursAgo(120), lastEventAt: hoursAgo(26) },
    { id: "home-3", jobTitle: "Welding inspector", employerName: "Harbour Metalworks", status: "applied", appliedAt: hoursAgo(72), lastEventAt: hoursAgo(72) },
  ];
}

// The two sides of one application, drawn by the components of the real dashboards (the employer's Applications by stage,
// the worker's Applications with the journey tracker stage of each). They are inert and hidden: a picture of the product, which
// the keyboard and assistive technology pass over, so their links and headings are not part of the page; the caption says what
// it shows.
export function Network({ lang, now }: { lang: string; now: Date }) {
  return (
    <Band aria-labelledby="home-network-heading" className="grid gap-12 sm:gap-16">
      <div className="grid max-w-3xl gap-4">
        <h2 id="home-network-heading" className="text-section text-balance">
          Workers and employers, connected
        </h2>
        <p className="text-lead text-pretty text-muted-foreground">
          A worker applies with their CHARA Passport and chooses which documents to share. The employer moves the application
          through the pipeline, and every stage reaches the worker&apos;s journey tracker.
        </p>
      </div>
      <figure className="grid gap-6">
        <div inert aria-hidden className="grid items-start gap-6 lg:grid-cols-2">
          <div className="grid gap-3">
            <p className="text-small font-medium text-muted-foreground">Employer dashboard</p>
            <StageTable id="home-preview-stages" title="Applications" countLabel="Applicants" totals={employerTotals} total={sumOf(employerTotals)} />
          </div>
          <div className="grid gap-3">
            <p className="text-small font-medium text-muted-foreground">Worker dashboard</p>
            <RecentApplications lang={lang} applications={workerApplications(now)} now={now} />
          </div>
        </div>
        <figcaption className="text-caption text-muted-foreground">Screens of {BRAND_NAME}, shown with fictional data.</figcaption>
      </figure>
    </Band>
  );
}
