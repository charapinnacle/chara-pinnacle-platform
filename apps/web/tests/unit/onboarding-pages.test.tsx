import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewOutcome } from "@/lib/dal/partner-review";

const requireUserMock = vi.hoisted(() => vi.fn());
const organizationMock = vi.hoisted(() => vi.fn());
const twoStepMock = vi.hoisted(() => vi.fn());
const passportMock = vi.hoisted(() => vi.fn());
const welcomeDueMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const geographiesMock = vi.hoisted(() => vi.fn());
const marketsLimitMock = vi.hoisted(() => vi.fn<() => number | null>());
const marketsAllowanceMock = vi.hoisted(() => vi.fn<() => number | null>());
const offerMock = vi.hoisted(() => vi.fn());
const commitmentMock = vi.hoisted(() => vi.fn());
const legalDocumentMock = vi.hoisted(() => vi.fn());
const reviewMock = vi.hoisted(() => vi.fn());
const pendingTokenMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>(async () => null));
const previewMock = vi.hoisted(() => vi.fn());
const outcomeMock = vi.hoisted(() => vi.fn<() => Promise<ReviewOutcome | null>>(async () => null));
const headerValues = vi.hoisted(() => ({ acceptLanguage: null as string | null }));
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(headerValues.acceptLanguage ? { "accept-language": headerValues.acceptLanguage } : {}),
}));
vi.mock("@/lib/dal/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/dal/organizations", () => ({
  getMyOrganization: organizationMock,
  getOrganizationProfile: async () => ({
    legalName: "Manila Skills Recruitment Inc.",
    displayName: "Manila Skills",
    country: "AT",
    industry: "F",
    website: "",
    description: "",
  }),
}));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/geographies", async () => ({
  ...(await vi.importActual<typeof import("@/lib/dal/geographies")>("@/lib/dal/geographies")),
  getOrganizationGeographies: geographiesMock,
}));
// The served-countries limit of marketsLimitMock and 10 occupations, on the Free plan.
vi.mock("@/lib/dal/usage", () => ({
  getUsagePrompts: async (_organizationId: string, _type: string, keys: string[]) =>
    Object.fromEntries(
      keys.map((limitKey) => {
        const limit = limitKey === "markets" ? marketsLimitMock() : 10;
        return [limitKey, limit === null ? null : { limitKey, used: 0, limit, resetsAt: null, planName: "Free", comparison: null }];
      }),
    ),
  // The limit of marketsAllowanceMock while the limits are not enforced.
  getUnenforcedAllowances: async (_organizationId: string, keys: string[]) =>
    Object.fromEntries(
      keys.map((key) => {
        const limit = key === "markets" ? marketsAllowanceMock() : null;
        return [key, limit === null ? null : { limit, planName: "Free" }];
      }),
    ),
}));
vi.mock("@/lib/actions/limits", () => ({ recordLimitPrompt: vi.fn() }));
vi.mock("@/lib/actions/geographies", () => ({ saveOrganizationGeographies: vi.fn() }));
vi.mock("@/lib/dal/workforce-offer", async () => ({
  ...(await vi.importActual<typeof import("@/lib/dal/workforce-offer")>("@/lib/dal/workforce-offer")),
  getWorkforceOffer: offerMock,
}));
vi.mock("@/lib/actions/workforce-offer", () => ({ saveWorkforceOffer: vi.fn() }));
vi.mock("@/lib/dal/mfa", () => ({ hasVerifiedTotpFactor: twoStepMock }));
vi.mock("@/lib/dal/passport", () => ({ getPassport: passportMock }));
vi.mock("@/lib/dal/reference", () => ({
  getCountries: async () => [
    { code: "AT", name: "Austria" },
    { code: "DE", name: "Germany" },
  ],
  getIndustries: async () => [{ code: "F", name: "Construction" }],
  getLanguages: async () => [{ code: "tl", name: "Tagalog" }],
  getOccupations: async () => [{ code: "7212", label: "Welders and flame cutters", synonyms: ["welder"] }],
}));
vi.mock("@/lib/dal/legal", () => ({
  getOnboardingDocuments: vi.fn(),
  getSignUpForm: vi.fn(),
  getLegalDocument: legalDocumentMock,
}));
vi.mock("@/lib/dal/commitment", () => ({ getCommitmentStatus: commitmentMock }));
const billingMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dal/billing", () => ({ getBillingState: billingMock }));
vi.mock("@/lib/dal/partner-review", () => ({
  getPartnerReview: reviewMock,
  getReviewOutcome: outcomeMock,
  getReviewTargetDays: async () => 1,
}));
vi.mock("@/lib/actions/partner-review", () => ({ submitForReview: vi.fn() }));
vi.mock("@/lib/actions/commitment", () => ({ acceptCommitment: vi.fn() }));
vi.mock("@/lib/dal/team", () => ({ getInvitationPreview: previewMock }));
vi.mock("@/lib/invitation-cookie", () => ({ pendingInvitationToken: pendingTokenMock }));
vi.mock("@/lib/welcome-cookie", () => ({ welcomeIsDue: welcomeDueMock }));
vi.mock("@/lib/actions/organizations", () => ({
  createOrganization: vi.fn(),
  createPartnerOrganization: vi.fn(),
  updateOrganizationProfile: vi.fn(),
}));
vi.mock("@/lib/actions/passport", () => ({ createPassport: vi.fn() }));
vi.mock("@/lib/actions/consents", () => ({ commitAccountKind: vi.fn(), chooseAccountKind: vi.fn() }));
vi.mock("@/lib/actions/mfa", () => ({ startFactorEnrolment: vi.fn(), verifyEnrolment: vi.fn() }));

const { default: OnboardingPage } = await import("@/app/[lang]/(onboarding)/onboarding/page");
const { default: SecurityPage } = await import("@/app/[lang]/(onboarding)/onboarding/security/page");
const { default: WelcomePage } = await import("@/app/[lang]/(onboarding)/onboarding/welcome/page");

type PageComponent = (props: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<React.ReactElement>;

async function render(page: PageComponent, searchParams: Record<string, string> = {}) {
  const { prelude } = await prerender(await page({ params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve(searchParams) }));
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
}

const emptyOffer = {
  occupations: [],
  industries: [],
  languages: [],
  recruitmentType: null,
  serviceTypes: [],
  sizeBand: null,
  foundedYear: null,
};
const savedOffer = { ...emptyOffer, occupations: ["7212"], recruitmentType: "international" };
const openCommitment = { version: 0, isDraft: true, accepted: false, acceptedVersion: null };
const commitmentDraft = {
  title: "DRAFT: Employer-pays commitment",
  version: 0,
  body: "DRAFT placeholder for review by legal counsel.\n\n## What this document will cover\n\nThe commitment.",
  changeSummary: "Draft placeholder pending approval by legal counsel.",
  publishedAt: "2026-11-16T10:00:00Z",
  isDraft: true,
  changeLog: [],
  changeLogTruncated: false,
};
const owner = { id: "org-1", slug: "acme-bau", displayName: "Acme Bau", type: "employer", role: "owner", suspended: false };
const currentStep = (html: string) => /<li aria-current="step"[^>]*>.*?Step \d of \d: <\/span>([^<]+)/.exec(html)?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  headerValues.acceptLanguage = null;
  requireUserMock.mockResolvedValue({ id: "user-1", email: "ana@example.test", accountKind: "company", intendedAccountKind: "company" });
  organizationMock.mockResolvedValue(null);
  twoStepMock.mockResolvedValue(false);
  passportMock.mockResolvedValue(null);
  welcomeDueMock.mockResolvedValue(true);
  releasedMock.mockResolvedValue(true);
  geographiesMock.mockResolvedValue({ sourcesFrom: [], servesMarket: [] });
  marketsLimitMock.mockReturnValue(3);
  marketsAllowanceMock.mockReturnValue(null);
  offerMock.mockResolvedValue(emptyOffer);
  commitmentMock.mockResolvedValue(openCommitment);
  legalDocumentMock.mockResolvedValue(commitmentDraft);
  reviewMock.mockResolvedValue({ status: "onboarding", submittedAt: null, infoStep: null });
  pendingTokenMock.mockResolvedValue(null);
});

describe("the first step of onboarding (resume)", () => {
  it("asks a company user without a company for it, on step 1 of 3, with the country of the browser chosen", async () => {
    headerValues.acceptLanguage = "de-AT,de;q=0.9";
    const html = await render(OnboardingPage);
    expect(currentStep(html)).toBe("Company");
    expect(html).toContain(">Tell us about your company</h1>");
    expect(html).toContain("This is how candidates see you. You can edit most of it later.");
    expect(html).not.toContain("cannot be changed");
    expect(html).toMatch(/<legend[^>]*>Company<\/legend>/);
    expect(html).toMatch(/<legend[^>]*>Registration<\/legend>/);
    expect(html).toContain(
      "We use it to give each company one free trial. 4 to 32 letters and digits, for example DE123456789 (VAT) or HRB12345 (company register)",
    );
    expect(html).toMatch(/<input[^>]*role="combobox"[^>]*value="Austria"|<input[^>]*value="Austria"[^>]*role="combobox"/);
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Continue<\/button>/);
  });

  it("leaves the country empty when the browser names no country of the list", async () => {
    headerValues.acceptLanguage = "en";
    const html = await render(OnboardingPage);
    expect(html).toMatch(/<input[^>]*id="org-country"[^>]*value=""/);
  });

  it("sends an owner who left before the two-step set-up back to it, and every other company user to the dashboard", async () => {
    organizationMock.mockResolvedValue(owner);
    await expect(render(OnboardingPage)).rejects.toThrow("REDIRECT:/en/onboarding/security");
    twoStepMock.mockResolvedValue(true);
    await expect(render(OnboardingPage)).rejects.toThrow("REDIRECT:/en/dashboard/employer");
    twoStepMock.mockResolvedValue(false);
    organizationMock.mockResolvedValue({ ...owner, role: "admin" });
    await expect(render(OnboardingPage)).rejects.toThrow("REDIRECT:/en/dashboard/employer");
  });

  it("asks a worker without a passport for it on step 1 of 2, and sends one with a passport to the dashboard", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "worker", intendedAccountKind: "worker" });
    const html = await render(OnboardingPage);
    expect(currentStep(html)).toBe("Your profile");
    expect(html).toContain(">Create your CHARA Passport</h1>");
    expect(html).not.toContain("Your account type is");
    passportMock.mockResolvedValue({ firstName: "Amira" });
    await expect(render(OnboardingPage)).rejects.toThrow("REDIRECT:/en/dashboard/worker");
  });
});

describe("the partner journey of onboarding (FR-J1)", () => {
  const partner = (type: "recruitment_company" | "staffing_company") => ({
    id: "user-2",
    aal: "aal1",
    email: "rita@example.test",
    accountKind: "company",
    intendedAccountKind: "company",
    intendedOrganizationType: type,
  });

  it("asks a recruitment company for its company on step 1 of 6, with the type fixed and the identifier required", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    const html = await render(OnboardingPage);
    expect(currentStep(html)).toBe("Company");
    expect(html).toContain("Step 6 of 6: </span>Ready");
    expect(html).toContain("Step 2 of 6: </span>Where you serve");
    expect(html).toContain("Company type: <strong");
    expect(html).toContain(">Recruitment company</strong>");
    expect(html).toContain("Country where you are based");
    expect(html).toContain("Company registration number, VAT number or other identifier");
    expect(html).not.toContain("optional until you start your trial");
    expect(html).toContain("About your company (optional)");
    expect(html).not.toMatch(/name="type"|organization_type/);
  });

  it("FR-J1: sends a partner who registered from an invitation of its type to that invitation, not to a company of its own", async () => {
    const token = "T".repeat(43);
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    pendingTokenMock.mockResolvedValue(token);
    previewMock.mockResolvedValue({ email: "Rita@Example.test", organizationType: "recruitment_company" });
    await expect(render(OnboardingPage)).rejects.toThrow(`REDIRECT:/en/invitations/${token}`);
    expect(previewMock).toHaveBeenCalledWith(token);
    // An invitation of another type, or to another address, leaves the partner with its own Company step.
    for (const preview of [
      { email: "rita@example.test", organizationType: "staffing_company" },
      { email: "rita@example.test", organizationType: "employer" },
      { email: "other@example.test", organizationType: "recruitment_company" },
    ]) {
      previewMock.mockResolvedValue(preview);
      expect(currentStep(await render(OnboardingPage))).toBe("Company");
    }
  });

  it("names the staffing type for a staffing company", async () => {
    requireUserMock.mockResolvedValue(partner("staffing_company"));
    expect(await render(OnboardingPage)).toContain(">Staffing company</strong>");
  });

  it("puts a partner with a company on the Where you serve step, never on Security or the dashboard", async () => {
    requireUserMock.mockResolvedValue(partner("staffing_company"));
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Staff", type: "staffing_company" });
    const html = await render(OnboardingPage);
    expect(currentStep(html)).toBe("Where you serve");
    expect(html).toMatch(/Step 1 of 6: <\/span>Company<span class="sr-only"> \(done\)<\/span>/);
    expect(html).toContain(">Where you serve</h1>");
    expect(html).toMatch(/<p aria-hidden="true"[^>]*>Step 2 of 6: Where you serve<\/p>/);
    expect(html).toMatch(/<dt[^>]*>Where are you based\?<\/dt><dd[^>]*>Austria<\/dd>/);
    expect(html).toContain("Where do you source workers from?");
    expect(html).toContain("Where do you supply workers for?");
    expect(html).not.toContain("Where do you recruit for?");
    expect(html).toContain(">0 of 3 countries</p>");
    expect(html).toContain(">0 countries</p>");
    expect(html.match(/No countries chosen yet\./g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Continue<\/button>/);
    expect(geographiesMock).toHaveBeenCalledWith("org-1");
    expect(redirectMock).not.toHaveBeenCalled();

    await expect(render(SecurityPage)).rejects.toThrow("REDIRECT:/en/onboarding");
    await expect(render(WelcomePage)).rejects.toThrow("REDIRECT:/en/onboarding");
  });

  it("asks a recruitment company where it recruits for, with the saved countries as chips and no limit when none applies", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    organizationMock.mockResolvedValue({ ...owner, type: "recruitment_company" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: [] });
    marketsLimitMock.mockReturnValue(null);
    const html = await render(OnboardingPage);
    expect(html).toContain("Where do you recruit for?");
    expect(html).toContain('aria-label="Remove Austria"');
    expect(html).toContain(">1 country</p>");
    expect(html).toContain(">0 countries</p>");
  });

  it("FR-R1: warns about served countries beyond the plan while limits are not enforced, and not within it", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    organizationMock.mockResolvedValue({ ...owner, type: "recruitment_company" });
    marketsLimitMock.mockReturnValue(null);
    marketsAllowanceMock.mockReturnValue(1);
    geographiesMock.mockResolvedValue({ sourcesFrom: [], servesMarket: ["DE", "AT"] });
    const over = await render(OnboardingPage);
    expect(over).toContain("2 of 1 country served on your Free plan.");
    expect(over).toContain("Plan limits are not enforced yet, so you can save these countries.");
    expect(over).toMatch(/<a[^>]*href="\/en\/org\/acme-bau\/billing"[^>]*>Compare plans<\/a>/);

    geographiesMock.mockResolvedValue({ sourcesFrom: [], servesMarket: ["DE"] });
    expect(await render(OnboardingPage)).not.toContain("Plan limits are not enforced yet");
  });

  it("asks for what the partner offers once both lists hold a country, on the step What you offer", async () => {
    requireUserMock.mockResolvedValue(partner("staffing_company"));
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Staff", type: "staffing_company" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    const html = await render(OnboardingPage);
    expect(currentStep(html)).toBe("What you offer");
    expect(html).toMatch(/<p aria-hidden="true"[^>]*>Step 3 of 6: What you offer<\/p>/);
    expect(html).toMatch(/Step 2 of 6: <\/span>Where you serve<span class="sr-only"> \(done\)<\/span>/);
    expect(html).toContain(">What you offer</h1>");
    expect(html).toContain("Which occupations do you recruit or supply?");
    expect(html).toContain(">0 of 10 occupations</p>");
    expect(html).toMatch(/<legend[^>]*>Recruitment type<\/legend>/);
    expect(html).toMatch(/<legend[^>]*>Staffing types \(choose at least one\)<\/legend>/);
    expect(html).not.toContain("We also supply staff (staffing)");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Continue<\/button>/);
    expect(offerMock).toHaveBeenCalledWith("org-1");
  });

  it("keeps a staffing company on What you offer until it names a staffing type", async () => {
    requireUserMock.mockResolvedValue(partner("staffing_company"));
    organizationMock.mockResolvedValue({ ...owner, type: "staffing_company" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    offerMock.mockResolvedValue(savedOffer);
    expect(await render(OnboardingPage)).toContain(">What you offer</h1>");
    offerMock.mockResolvedValue({ ...savedOffer, serviceTypes: ["temporary"] });
    expect(await render(OnboardingPage)).toContain(">Commitments</h1>");
  });

  it("moves on to Commitments once the countries and the offer are saved, with the draft text, the box and a way back", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Skills", type: "recruitment_company" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    offerMock.mockResolvedValue(savedOffer);
    const html = await render(OnboardingPage);
    expect(currentStep(html)).toBe("Commitments");
    expect(html).toMatch(/Step 2 of 6: <\/span>Where you serve<span class="sr-only"> \(done\)<\/span>/);
    expect(html).toContain(">Commitments</h1>");
    expect(html).toContain("Workers never pay fees to get a job through Chara Pinnacle. Every recruitment and staffing company");
    expect(html).toContain("Draft - not yet approved by legal counsel.");
    expect(html).toMatch(/<h2 id="commitment-title"[^>]*>Employer-pays commitment<span[^>]*>Draft<\/span><\/h2>/);
    expect(html).toContain("Version 0 · ");
    expect(html).toMatch(/<h3[^>]*>What this document will cover<\/h3>/);
    expect(html).not.toContain("What changed:");
    expect(html).toMatch(/<a[^>]*target="_blank"[^>]*href="\/en\/legal\/employer-pays-commitment">Read the full text/);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*id="commitment-confirmed"/);
    expect(html).not.toMatch(/<input[^>]*id="commitment-confirmed"[^>]*checked/);
    expect(html).toContain(">We charge workers no recruitment fees or related costs</label>");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Accept and continue<\/button>/);
    expect(html).toMatch(/<a[^>]*href="\/en\/onboarding\?step=where-you-serve"[^>]*>Change where you serve/);
    expect(html).toMatch(/<a[^>]*href="\/en\/onboarding\?step=what-you-offer"[^>]*>Change what you offer/);
    expect(commitmentMock).toHaveBeenCalledWith("org-1");
    expect(legalDocumentMock).toHaveBeenCalledWith("employer-pays-commitment");

    const reopened = await render(OnboardingPage, { step: "where-you-serve" });
    expect(currentStep(reopened)).toBe("Where you serve");
    expect(reopened).toContain('aria-label="Remove Germany"');

    const offer = await render(OnboardingPage, { step: "what-you-offer" });
    expect(offer).toContain(">What you offer</h1>");
    expect(offer).toContain('aria-label="Remove Welders and flame cutters"');
    expect(offer).toContain("We also supply staff (staffing)");
    expect(offer).not.toMatch(/<legend[^>]*>Staffing types/);
  });

  it("keeps the step closed while release 2a is off, and leaves the countries to the owner or an admin", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Skills", type: "recruitment_company" });
    releasedMock.mockResolvedValue(false);
    let html = await render(OnboardingPage);
    expect(html).toContain(">Next: Where you serve</h1>");
    expect(html).toContain("This step is not open yet. Manila Skills is saved");
    expect(geographiesMock).not.toHaveBeenCalled();

    releasedMock.mockResolvedValue(true);
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Skills", type: "recruitment_company", role: "member" });
    html = await render(OnboardingPage, { step: "where-you-serve" });
    expect(html).toContain("The owner or an admin of Manila Skills chooses the countries where you serve.");
    expect(html).not.toContain("<form");
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    html = await render(OnboardingPage, { step: "what-you-offer" });
    expect(html).toContain(">Next: What you offer</h1>");
    expect(html).toContain("The owner or an admin of Manila Skills chooses what you offer.");
    expect(html).not.toContain("<form");
    offerMock.mockResolvedValue(savedOffer);
    html = await render(OnboardingPage, { step: "where-you-serve" });
    expect(html).toContain(">Commitments</h1>");
    expect(html).toContain("Only the owner of Manila Skills can accept the commitment.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Change where you serve");
    expect(html).not.toContain("Change what you offer");
  });

  it("leaves the commitment to the owner: an admin reads it and is told so, with the links back", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Skills", type: "recruitment_company", role: "admin" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    offerMock.mockResolvedValue(savedOffer);
    const html = await render(OnboardingPage);
    expect(html).toContain(">Commitments</h1>");
    expect(html).toMatch(/<div[^>]*role="status"[^>]*>Only the owner of Manila Skills can accept the commitment\./);
    expect(html).toContain("What this document will cover");
    expect(html).not.toContain("<form");
    expect(html).toContain("Change what you offer");
  });

  it("shows what changed when the owner accepted an earlier version, without the draft notice", async () => {
    requireUserMock.mockResolvedValue(partner("staffing_company"));
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Staff", type: "staffing_company" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    offerMock.mockResolvedValue({ ...savedOffer, serviceTypes: ["temporary"] });
    commitmentMock.mockResolvedValue({ version: 1, isDraft: false, accepted: false, acceptedVersion: 0 });
    legalDocumentMock.mockResolvedValue({
      ...commitmentDraft,
      title: "Employer-pays commitment",
      version: 1,
      body: "We charge workers nothing.",
      changeSummary: "Counsel's text replaces the draft.",
      isDraft: false,
    });
    const html = await render(OnboardingPage);
    expect(html).toContain("The employer-pays commitment has changed since Manila Staff accepted it.");
    expect(html).toContain("What changed:</span> Counsel&#x27;s text replaces the draft.");
    expect(html).not.toContain("Draft - not yet approved by legal counsel.");
    expect(html).toContain("Version 1 · ");
    expect(html).toContain("Accept and continue");
  });

  it("moves on to Security once the commitment is accepted, where the owner sets up two-step verification", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Skills", type: "recruitment_company" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    offerMock.mockResolvedValue(savedOffer);
    commitmentMock.mockResolvedValue({ version: 0, isDraft: true, accepted: true, acceptedVersion: 0 });
    const html = await render(OnboardingPage);
    expect(currentStep(html)).toBe("Security");
    expect(html).toMatch(/Step 4 of 6: <\/span>Commitments<span class="sr-only"> \(done\)<\/span>/);
    expect(html).toContain(">Secure your account</h1>");
    expect(html).toContain("As the owner of Manila Skills you will manage its team, billing, job orders and candidates");
    expect(html).toContain("Show the QR code");
    expect(html).not.toContain("This step is not open yet.");

    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Skills", type: "recruitment_company", role: "admin" });
    expect(await render(OnboardingPage)).toContain("As an admin of Manila Skills you will manage");
  });

  it("opens Ready once Security is done, with what staff check, the review time and the submission", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    organizationMock.mockResolvedValue({ ...owner, slug: "manila-skills", displayName: "Manila Skills", type: "recruitment_company" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    offerMock.mockResolvedValue(savedOffer);
    commitmentMock.mockResolvedValue({ version: 0, isDraft: true, accepted: true, acceptedVersion: 0 });
    twoStepMock.mockResolvedValue(true);
    for (const html of [await render(OnboardingPage), await render(OnboardingPage, { step: "ready" })]) {
      expect(currentStep(html)).toBe("Ready");
      expect(html).toMatch(/Step 5 of 6: <\/span>Security<span class="sr-only"> \(done\)<\/span>/);
      expect(html).toContain(">Submit your company for review</h1>");
      expect(html).toContain("A review usually takes one working day.");
      expect(html).toContain(">What our team checks</h2>");
      expect(html).toContain("<li>Your company name and registration number</li><li>Your website</li><li>The licences you declare</li>");
      expect(html).toMatch(/<button[^>]*type="button"[^>]*>Submit for review<\/button>/);
      expect(html).toMatch(/<a[^>]*href="\/en\/onboarding\?step=company"[^>]*>Change your company details/);
      expect(html).toMatch(/<a[^>]*href="\/en\/onboarding\?step=where-you-serve"[^>]*>Change where you serve/);
      expect(html).not.toMatch(/approved|verified/i);
    }
  });

  it("lets a member read Ready without the submission, and skips Security for a member", async () => {
    requireUserMock.mockResolvedValue(partner("staffing_company"));
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Staff", type: "staffing_company", role: "member" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    offerMock.mockResolvedValue({ ...savedOffer, serviceTypes: ["temporary"] });
    commitmentMock.mockResolvedValue({ version: 0, isDraft: true, accepted: true, acceptedVersion: 0 });
    const html = await render(OnboardingPage);
    expect(currentStep(html)).toBe("Ready");
    expect(html).toContain("The owner or an admin of Manila Staff submits the company for review.");
    expect(html).not.toContain("Submit for review</button>");
    expect(html).not.toContain("Change your company details");
    expect(twoStepMock).not.toHaveBeenCalled();
  });

  it("FR-J1 AC8: sends the address of Ready to the first step not done", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    organizationMock.mockResolvedValue({ ...owner, type: "recruitment_company" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    offerMock.mockResolvedValue(savedOffer);
    await expect(render(OnboardingPage, { step: "ready" })).rejects.toThrow("REDIRECT:/en/onboarding");
    commitmentMock.mockResolvedValue({ version: 0, isDraft: true, accepted: true, acceptedVersion: 0 });
    await expect(render(OnboardingPage, { step: "ready" })).rejects.toThrow("REDIRECT:/en/onboarding");
    twoStepMock.mockResolvedValue(true);
    expect(currentStep(await render(OnboardingPage, { step: "ready" }))).toBe("Ready");
  });

  it("FR-J1 AC11: shows the pending state once submitted, and the dashboard to a listed or declined partner", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    organizationMock.mockResolvedValue({ ...owner, slug: "manila-skills", displayName: "Manila Skills", type: "recruitment_company" });
    for (const status of ["pending_review", "re_review"]) {
      reviewMock.mockResolvedValue({ status, submittedAt: "2026-11-21T10:00:00Z", infoStep: null });
      const html = await render(OnboardingPage, { step: "where-you-serve" });
      expect(currentStep(html)).toBe("Ready");
      expect(html).toContain(">Your company is waiting for review</h1>");
      expect(html).toContain("Our team is reviewing Manila Skills. A review usually takes one working day.");
      expect(html).toContain("The licences you declare");
      const tiles = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>.*?<span class="text-body font-semibold">([^<]+)<\/span>/g)].map(
        (match) => [match[1], match[2]],
      );
      expect(tiles).toEqual([
        ["/en/org/manila-skills/workforce-profile", "Complete your workforce profile"],
        ["/en/org/manila-skills/billing", "Choose a plan"],
        ["/en/org/manila-skills/members", "Invite your team"],
        ["/en/dashboard/employer", "Go to your dashboard"],
      ]);
      expect(html).not.toMatch(/approved|verified/i);
      expect(html).not.toContain("<form");
    }
    expect(geographiesMock).not.toHaveBeenCalled();
    // A member is offered neither the plan nor the invitations, which are for the owner and admins.
    organizationMock.mockResolvedValue({
      ...owner,
      role: "member",
      slug: "manila-skills",
      displayName: "Manila Skills",
      type: "recruitment_company",
    });
    reviewMock.mockResolvedValue({ status: "pending_review", submittedAt: "2026-11-21T10:00:00Z", infoStep: null });
    const memberHtml = await render(OnboardingPage);
    expect(memberHtml).not.toContain("Invite your team");
    expect(memberHtml).not.toContain("Choose a plan");
    organizationMock.mockResolvedValue({ ...owner, slug: "manila-skills", displayName: "Manila Skills", type: "recruitment_company" });
    for (const status of ["listed", "declined"]) {
      reviewMock.mockResolvedValue({ status, submittedAt: null, infoStep: null });
      await expect(render(OnboardingPage)).rejects.toThrow("REDIRECT:/en/dashboard/employer");
      // The company details stay editable past onboarding, on the company profile page (FR-J1).
      await expect(render(OnboardingPage, { step: "company" })).rejects.toThrow("REDIRECT:/en/org/manila-skills/profile");
    }
    organizationMock.mockResolvedValue({ ...owner, slug: "manila-skills", displayName: "Manila Skills", type: "recruitment_company", role: "member" });
    reviewMock.mockResolvedValue({ status: "listed", submittedAt: null, infoStep: null });
    await expect(render(OnboardingPage, { step: "company" })).rejects.toThrow("REDIRECT:/en/dashboard/employer");
  });

  it("FR-J4 AC7: after a request for information Ready names the reopened step and links to it", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Skills", type: "recruitment_company" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    offerMock.mockResolvedValue(savedOffer);
    commitmentMock.mockResolvedValue({ version: 0, isDraft: true, accepted: true, acceptedVersion: 0 });
    twoStepMock.mockResolvedValue(true);
    reviewMock.mockResolvedValue({ status: "info_requested", submittedAt: "2026-11-21T10:00:00Z", infoStep: "where_you_serve" });
    outcomeMock.mockResolvedValue({
      decision: "request_info",
      reason: "Please add the countries you source workers from.",
      infoStep: "where_you_serve",
      decidedAt: "2026-11-22T10:00:00Z",
    });
    const html = await render(OnboardingPage);
    expect(currentStep(html)).toBe("Ready");
    expect(html).toContain(">Submit your company again</h1>");
    expect(html).toContain("Our team asked for more information about where you serve and what you offer.");
    expect(html).toContain("Message from our team");
    expect(html).toContain("Please add the countries you source workers from.");
    expect(html).toMatch(/<a[^>]*href="\/en\/onboarding\?step=where-you-serve"[^>]*>Change where you serve/);
    expect(html).toMatch(/Step 2 of 6: <\/span>Where you serve<span class="sr-only"> \(more information requested\)<\/span>/);
    expect(html).toMatch(/Step 1 of 6: <\/span>Company<span class="sr-only"> \(done\)<\/span>/);
    expect(html).toMatch(/<button[^>]*>Submit again for review<\/button>/);

    reviewMock.mockResolvedValue({ status: "info_requested", submittedAt: null, infoStep: "commitments" });
    const commitments = await render(OnboardingPage);
    expect(commitments).toMatch(/<a[^>]*href="\/en\/onboarding\?step=commitments"[^>]*>Review the commitment/);
    const reopened = await render(OnboardingPage, { step: "commitments" });
    expect(currentStep(reopened)).toBe("Commitments");
    expect(reopened).toContain("Manila Skills has accepted the employer-pays commitment.");
    expect(reopened).not.toContain("<form");
    expect(reopened).toMatch(/<a[^>]*href="\/en\/onboarding\?step=ready"[^>]*>Back to Ready/);
  });

  it("reopens the company details for the owner at aal2, and asks for the code first at aal1", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Skills", type: "recruitment_company" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    offerMock.mockResolvedValue(savedOffer);
    await expect(render(OnboardingPage, { step: "company" })).rejects.toThrow(
      `REDIRECT:/en/mfa?next=${encodeURIComponent("/en/onboarding?step=company")}`,
    );
    requireUserMock.mockResolvedValue({ ...partner("recruitment_company"), aal: "aal2" });
    billingMock.mockResolvedValue({ identifier: "CS201904512", identifier_kind: "registration_number", identifier_locked: false });
    const html = await render(OnboardingPage, { step: "company" });
    expect(currentStep(html)).toBe("Company");
    expect(html).toContain(">Your company details</h1>");
    expect(html).toContain('value="Manila Skills Recruitment Inc."');
    expect(html).toContain("The name employers see on your profile.");
    expect(html).not.toContain("candidates");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save profile<\/button>/);
    expect(html).toContain(">Company identifier</h2>");
    expect(html).toContain(": CS201904512. You correct it here.");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save identifier<\/button>/);
    expect(html).not.toMatch(/readonly/i);
    billingMock.mockResolvedValue({ identifier: "CS201904512", identifier_kind: "registration_number", identifier_locked: true });
    const locked = await render(OnboardingPage, { step: "company" });
    expect(locked).toMatch(/<input[^>]*id="org-legal-name"[^>]*readOnly|<input[^>]*readOnly[^>]*id="org-legal-name"/i);
    expect(locked).toContain("It cannot be changed once a payment has been started for the company.");
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Skills", type: "recruitment_company", role: "member" });
    expect(await render(OnboardingPage, { step: "company" })).not.toContain("Your company details");
  });

  it("titles the commit step after the partner type", async () => {
    requireUserMock.mockResolvedValue({ ...partner("recruitment_company"), accountKind: null });
    const { getOnboardingDocuments } = await import("@/lib/dal/legal");
    vi.mocked(getOnboardingDocuments).mockResolvedValue({ documents: [], attestationWording: null });
    expect(await render(OnboardingPage)).toContain(">Set up your Recruitment company account</h1>");
  });
});

describe("the two-step set-up step of onboarding", () => {
  it("is step 2 of 3 for an owner without an authenticator, explains why and returns to the welcome screen", async () => {
    organizationMock.mockResolvedValue(owner);
    const html = await render(SecurityPage);
    expect(currentStep(html)).toBe("Security");
    expect(html).toMatch(/Step 1 of 3: <\/span>Company<span class="sr-only"> \(done\)<\/span>/);
    expect(html).toContain(
      "As the owner you can see applicants&#x27; documents and your company&#x27;s billing, so Chara Pinnacle asks for a code from an authenticator app before you open them.",
    );
    expect(html).toContain("Show the QR code");
  });

  it("is not for anyone else: a worker, a company user without a company, an administrator or an owner already set up", async () => {
    requireUserMock.mockResolvedValueOnce({ id: "user-1", accountKind: "worker" });
    await expect(render(SecurityPage)).rejects.toThrow("REDIRECT:/en/dashboard/worker");
    await expect(render(SecurityPage)).rejects.toThrow("REDIRECT:/en/onboarding");
    organizationMock.mockResolvedValue({ ...owner, role: "admin" });
    await expect(render(SecurityPage)).rejects.toThrow("REDIRECT:/en/dashboard/employer");
    organizationMock.mockResolvedValue(owner);
    twoStepMock.mockResolvedValue(true);
    await expect(render(SecurityPage)).rejects.toThrow("REDIRECT:/en/dashboard/employer");
  });
});

describe("the welcome screen", () => {
  it("welcomes the company by its display name on the last step, with three next actions and Post your first job first", async () => {
    organizationMock.mockResolvedValue(owner);
    const html = await render(WelcomePage);
    expect(welcomeDueMock).toHaveBeenCalledWith("user-1");
    expect(currentStep(html)).toBe("Ready");
    expect(html).toContain(">Welcome to Chara Pinnacle, Acme Bau</h1>");
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>.*?<span class="text-body font-semibold">([^<]+)<\/span>/g)].map(
      (match) => [match[1], match[2]],
    );
    expect(links).toEqual([
      ["/en/org/acme-bau/jobs/new", "Post your first job"],
      ["/en/org/acme-bau/members", "Invite your team"],
      ["/en/org/acme-bau/billing", "Review your plan"],
    ]);
  });

  it("welcomes a worker by the first name, with Search jobs first", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "worker" });
    passportMock.mockResolvedValue({ firstName: "Amira" });
    const html = await render(WelcomePage);
    expect(currentStep(html)).toBe("Ready");
    expect(html).toContain(">Welcome to Chara Pinnacle, Amira</h1>");
    expect([...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "/en/jobs",
      "/en/passport",
      "/en/passport#experience",
    ]);
  });

  it("is shown only once: without the mark of the last step the person goes to the dashboard", async () => {
    welcomeDueMock.mockResolvedValue(false);
    organizationMock.mockResolvedValue(owner);
    await expect(render(WelcomePage)).rejects.toThrow("REDIRECT:/en/dashboard/employer");
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "worker" });
    await expect(render(WelcomePage)).rejects.toThrow("REDIRECT:/en/dashboard/worker");
  });

  it("sends a person whose last step is not done back to onboarding", async () => {
    await expect(render(WelcomePage)).rejects.toThrow("REDIRECT:/en/onboarding");
    requireUserMock.mockResolvedValue({ id: "user-1", accountKind: "worker" });
    await expect(render(WelcomePage)).rejects.toThrow("REDIRECT:/en/onboarding");
  });
});
