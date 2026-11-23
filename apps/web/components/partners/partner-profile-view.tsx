import { TextLink } from "@/components/forms/text-link";
import { partnerTypeLabels } from "@/components/forms/account-kind-options";
import { Card } from "@/components/layout/card";
import { DetailList } from "@/components/layout/detail-list";
import { PageHeader } from "@/components/layout/page-header";
import { ImmigrationNotice } from "@/components/public/immigration-notice";
import { formatDate, workerCount } from "@/lib/i18n/format";
import { publicWebsite } from "@/lib/jobs/presentation";
import type { Named, PartnerProfile } from "@/lib/partners/profile";
import { loginPath, partnerProfilePath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { WORKERS_NEVER_PAY } from "@/lib/validation/commitment";
import { recruitmentTypeLabels, sizeBandLabels, staffingTypeLabels } from "@/lib/validation/workforce-offer";

type PartnerProfileViewProps = {
  lang: string;
  profile: PartnerProfile;
  // The viewer's actions (FR-K4 AC4) or the preview banner; the page that owns the viewer decides.
  actions?: React.ReactNode;
  banner?: React.ReactNode;
};

// The served countries in the words of the partner's own form (FR-K1 AC9, lib/validation/geographies.ts servedQuestion).
const servedLabels: Record<PartnerProfile["type"], string> = {
  recruitment_company: "Recruits for",
  staffing_company: "Supplies workers for",
};

const names = (items: readonly Named[]) => items.map((item) => item.name).join(", ");

function ProfileSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-3">
      <h2 id={`${id}-heading`} className="text-h2">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Countries({ items, empty }: { items: readonly Named[]; empty: string }) {
  return <>{items.length === 0 ? empty : names(items)}</>;
}

// The CHARA Workforce Profile of a listed partner (FR-K4, spec section 17), shared by the public page and the members'
// preview. Only the partner's own structured data is shown: no badge, rating, ranking, platform figure or word of
// verification [d2.5, d2.6], and no member, contact detail or licence (DATA_MODEL.md section 10).
export function PartnerProfileView({ lang, profile, actions, banner }: PartnerProfileViewProps) {
  const kind = partnerTypeLabels[profile.type];
  const website = publicWebsite(profile.website);
  const staffingTypes = profile.serviceTypes.flatMap((service) => (service === "staffing" ? [] : [staffingTypeLabels[service]]));
  const overview = [
    ...(profile.recruitmentType ? [{ label: "Recruitment type", value: recruitmentTypeLabels[profile.recruitmentType] }] : []),
    ...(staffingTypes.length > 0 ? [{ label: "Staffing types", value: staffingTypes.join(", ") }] : []),
    ...(profile.foundedYear !== null ? [{ label: "Years operating", value: `Operating since ${profile.foundedYear}` }] : []),
    ...(profile.sizeBand ? [{ label: "Company size", value: sizeBandLabels[profile.sizeBand] }] : []),
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

  return (
    <div className="@container grid gap-8">
      {banner}
      <article className={cn("grid gap-8", actions && "@4xl:grid-cols-[minmax(0,1fr)_20rem] @4xl:gap-x-12")}>
        <PageHeader title={profile.displayName} className="animate-rise gap-3 @4xl:col-start-1">
          <p className="text-body break-words text-muted-foreground">
            {kind} · Based in {profile.basedIn.name}
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
          <ProfileSection id="profile-overview" title="Overview">
            {profile.description ? (
              <p className="max-w-[65ch] leading-7 break-words whitespace-pre-line">{profile.description}</p>
            ) : null}
            {overview.length > 0 ? <DetailList items={overview} /> : null}
          </ProfileSection>

          <ProfileSection id="profile-where" title="Where we serve">
            <DetailList
              items={[
                { label: "Based in", value: profile.basedIn.name },
                { label: "Sources workers from", value: <Countries items={profile.sourceCountries} empty="None listed" /> },
                { label: servedLabels[profile.type], value: <Countries items={profile.servedCountries} empty="None listed" /> },
              ]}
            />
            {profile.updatedAt ? (
              <p className="text-small text-muted-foreground">
                Last updated <time dateTime={profile.updatedAt}>{formatDate(profile.updatedAt)}</time>
              </p>
            ) : null}
          </ProfileSection>

          <ProfileSection id="profile-offer" title="Industries and occupations">
            <DetailList
              items={[
                { label: "Industries", value: profile.industries.length === 0 ? "None listed" : names(profile.industries) },
                { label: "Occupations", value: profile.occupations.length === 0 ? "None listed" : names(profile.occupations) },
              ]}
            />
          </ProfileSection>

          <ProfileSection id="profile-capacity" title="Workforce capacity">
            {profile.listings === null ? (
              <p className="text-body text-muted-foreground">
                <TextLink href={loginPath(lang, partnerProfilePath(lang, profile.slug))}>Sign in</TextLink> to see the workers
                available and the monthly capacity.
              </p>
            ) : profile.listings.length === 0 ? (
              <p className="text-body text-muted-foreground">No current availability listed</p>
            ) : (
              <ul className="grid gap-3">
                {profile.listings.map((listing) => (
                  <li
                    key={`${listing.occupation}-${listing.sourceCountry}`}
                    className="grid gap-1 rounded-xl border bg-card p-card"
                  >
                    <p className="font-medium break-words">
                      {listing.occupation} from {listing.sourceCountry}
                    </p>
                    <p className="text-body">
                      {workerCount(listing.available)} available, {workerCount(listing.monthlyCapacity)} a month, from{" "}
                      <time dateTime={listing.availableFrom}>{formatDate(listing.availableFrom)}</time>
                    </p>
                    <p className="text-small text-muted-foreground">
                      Confirmed on <time dateTime={listing.confirmedAt}>{formatDate(listing.confirmedAt)}</time>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </ProfileSection>

          {profile.languages.length > 0 ? (
            <ProfileSection id="profile-languages" title="Languages">
              <p className="text-body">{names(profile.languages)}</p>
            </ProfileSection>
          ) : null}

          {profile.commitmentCurrent ? (
            <ProfileSection id="profile-commitment" title="Commitment">
              <p className="max-w-[65ch] text-body">
                {WORKERS_NEVER_PAY}. {profile.displayName} has accepted the employer-pays commitment.
              </p>
              <TextLink standalone href={`/${lang}/legal/employer-pays-commitment`}>
                Read the employer-pays commitment
              </TextLink>
            </ProfileSection>
          ) : null}

          <ImmigrationNotice lang={lang} />
        </div>
      </article>
    </div>
  );
}
