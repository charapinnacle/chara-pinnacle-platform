import { Notice } from "@/components/forms/notice";
import type { ApplicantSnapshot } from "@/lib/applicants/snapshot";
import { formatDate, formatIsoDate } from "@/lib/i18n/format";

type Names = Record<string, string>;

type ProfileSnapshotProps = {
  snapshot: ApplicantSnapshot;
  coverNote: string | null;
  submittedAt: string;
  changed: boolean | null;
  countries: Names;
  languages: Names;
};

function availabilityText({ availability, available_from }: ApplicantSnapshot): string | null {
  if (availability === "now") return "Available now";
  if (availability === "from_date" && available_from) return `Available from ${formatDate(available_from)}`;
  return availability === "unavailable" ? "Not available" : null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium wrap-anywhere">{children}</dd>
    </div>
  );
}

// The profile as the application stored it, never the live one: the indicator only says that the live profile differs.
// Dates of birth, nationality and the like are not in the snapshot at all.
export function ProfileSnapshot({ snapshot, coverNote, submittedAt, changed, countries, languages }: ProfileSnapshotProps) {
  const country = (code: string) => countries[code] ?? code;
  const availability = availabilityText(snapshot);
  const experience = snapshot.years_experience;
  return (
    <section aria-labelledby="profile-heading" className="grid gap-3">
      <div className="grid gap-1">
        <h2 id="profile-heading" className="text-lg font-semibold">
          Profile as submitted
        </h2>
        <p className="text-sm text-muted-foreground">Submitted {formatIsoDate(submittedAt)}</p>
      </div>
      {changed ? (
        <Notice tone="info" role="status">
          Profile changed since this application was submitted
        </Notice>
      ) : null}
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {snapshot.headline ? <Row label="Headline">{snapshot.headline}</Row> : null}
        {snapshot.occupation ? <Row label="Occupation">{snapshot.occupation}</Row> : null}
        {snapshot.current_country ? <Row label="Country">{country(snapshot.current_country)}</Row> : null}
        {experience != null ? <Row label="Experience">{experience === 1 ? "1 year" : `${experience} years`}</Row> : null}
        {availability ? <Row label="Availability">{availability}</Row> : null}
        {snapshot.skills.length > 0 ? (
          <Row label="Skills">
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {snapshot.skills.map((skill) => (
                <li key={skill}>{skill}</li>
              ))}
            </ul>
          </Row>
        ) : null}
        {snapshot.languages.length > 0 ? (
          <Row label="Languages">
            <ul>
              {snapshot.languages.map(({ code, level }) => (
                <li key={code}>
                  {languages[code] ?? code}, {level}
                </li>
              ))}
            </ul>
          </Row>
        ) : null}
        {snapshot.preferred_countries.length > 0 ? (
          <Row label="Preferred countries">{snapshot.preferred_countries.map(country).join(", ")}</Row>
        ) : null}
        {snapshot.work_authorizations.length > 0 ? (
          <Row label="Work authorization">
            <ul>
              {snapshot.work_authorizations.map(({ country: code, expires_on }) => (
                <li key={code}>
                  {country(code)}
                  {expires_on ? `, valid until ${formatDate(expires_on)}` : ""}
                </li>
              ))}
            </ul>
          </Row>
        ) : null}
      </dl>
      {coverNote ? (
        <div className="grid gap-1">
          <h3 className="text-sm text-muted-foreground">Cover note</h3>
          <p className="wrap-anywhere whitespace-pre-line">{coverNote}</p>
        </div>
      ) : null}
    </section>
  );
}
