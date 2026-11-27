import { TabLinks } from "@/components/layout/tab-links";
import {
  findWorkersPath,
  invitationsPath,
  jobOrdersPath,
  orgContactRequestsPath,
  partnerSubmissionsPath,
  responsesPath,
} from "@/lib/routes";

// Pages that belong together under one sidebar item, as tabs at the top of each (the sidebar item stays current on both).

export function JobOrderTabs({ lang, slug, current }: { lang: string; slug: string; current: "job-orders" | "invitations" }) {
  return (
    <TabLinks
      label="Job orders"
      items={[
        { key: "job-orders", href: jobOrdersPath(lang, slug), label: "Open job orders", current: current === "job-orders" },
        { key: "invitations", href: invitationsPath(lang, slug), label: "Invitations", current: current === "invitations" },
      ]}
    />
  );
}

// Submissions only while candidate submissions are released: until then Responses has no tab row.
export function ResponseTabs({
  lang,
  slug,
  current,
  submissions,
}: {
  lang: string;
  slug: string;
  current: "responses" | "submissions";
  submissions: boolean;
}) {
  if (!submissions) return null;
  return (
    <TabLinks
      label="Responses"
      items={[
        { key: "responses", href: responsesPath(lang, slug), label: "Responses", current: current === "responses" },
        { key: "submissions", href: partnerSubmissionsPath(lang, slug), label: "Submissions", current: current === "submissions" },
      ]}
    />
  );
}

export function WorkerTabs({ lang, slug, current }: { lang: string; slug: string; current: "find-workers" | "contact-requests" }) {
  return (
    <TabLinks
      label="Find workers"
      items={[
        { key: "find-workers", href: findWorkersPath(lang, slug), label: "Search workers", current: current === "find-workers" },
        { key: "contact-requests", href: orgContactRequestsPath(lang, slug), label: "Contact requests", current: current === "contact-requests" },
      ]}
    />
  );
}
