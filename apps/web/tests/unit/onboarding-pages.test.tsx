import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.hoisted(() => vi.fn());
const organizationMock = vi.hoisted(() => vi.fn());
const twoStepMock = vi.hoisted(() => vi.fn());
const passportMock = vi.hoisted(() => vi.fn());
const welcomeDueMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const geographiesMock = vi.hoisted(() => vi.fn());
const marketsLimitMock = vi.hoisted(() => vi.fn());
const offerMock = vi.hoisted(() => vi.fn());
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
  getOrganizationProfile: async () => ({ country: "AT" }),
}));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/geographies", async () => ({
  ...(await vi.importActual<typeof import("@/lib/dal/geographies")>("@/lib/dal/geographies")),
  getOrganizationGeographies: geographiesMock,
  getMarketsLimit: marketsLimitMock,
}));
vi.mock("@/lib/actions/geographies", () => ({ saveOrganizationGeographies: vi.fn() }));
vi.mock("@/lib/dal/workforce-offer", async () => ({
  ...(await vi.importActual<typeof import("@/lib/dal/workforce-offer")>("@/lib/dal/workforce-offer")),
  getWorkforceOffer: offerMock,
  getOccupationsLimit: async () => 10,
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
vi.mock("@/lib/dal/legal", () => ({ getOnboardingDocuments: vi.fn(), getSignUpForm: vi.fn() }));
vi.mock("@/lib/dal/team", () => ({ getInvitationPreview: vi.fn() }));
vi.mock("@/lib/invitation-cookie", () => ({ pendingInvitationToken: async () => null }));
vi.mock("@/lib/welcome-cookie", () => ({ welcomeIsDue: welcomeDueMock }));
vi.mock("@/lib/actions/organizations", () => ({ createOrganization: vi.fn(), createPartnerOrganization: vi.fn() }));
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
  marketsLimitMock.mockResolvedValue(3);
  offerMock.mockResolvedValue(emptyOffer);
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
    email: "rita@example.test",
    accountKind: "company",
    intendedAccountKind: "company",
    intendedOrganizationType: type,
  });

  it("asks a recruitment company for its company on step 1 of 5, with the type fixed and the identifier required", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    const html = await render(OnboardingPage);
    expect(currentStep(html)).toBe("Company");
    expect(html).toContain("Step 5 of 5: </span>Ready");
    expect(html).toContain("Step 2 of 5: </span>Where you serve");
    expect(html).toContain("Company type: <strong");
    expect(html).toContain(">Recruitment company</strong>");
    expect(html).toContain("Country where you are based");
    expect(html).toContain("Company registration number, VAT number or other identifier");
    expect(html).not.toContain("optional until you start your trial");
    expect(html).toContain("About your company (optional)");
    expect(html).not.toMatch(/name="type"|organization_type/);
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
    expect(html).toMatch(/Step 1 of 5: <\/span>Company<span class="sr-only"> \(done\)<\/span>/);
    expect(html).toContain(">Where you serve</h1>");
    expect(html).toMatch(/<p aria-hidden="true"[^>]*>Step 2 of 5: Where you serve<\/p>/);
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
    marketsLimitMock.mockResolvedValue(null);
    const html = await render(OnboardingPage);
    expect(html).toContain("Where do you recruit for?");
    expect(html).toContain('aria-label="Remove Austria"');
    expect(html).toContain(">1 country</p>");
    expect(html).toContain(">0 countries</p>");
  });

  it("asks for what the partner offers once both lists hold a country, still within Where you serve", async () => {
    requireUserMock.mockResolvedValue(partner("staffing_company"));
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Staff", type: "staffing_company" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    const html = await render(OnboardingPage);
    expect(currentStep(html)).toBe("Where you serve");
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
    expect(await render(OnboardingPage)).toContain(">Next: Commitments</h1>");
  });

  it("moves on to the pending Commitments step once the countries and the offer are saved, with a way back to each", async () => {
    requireUserMock.mockResolvedValue(partner("recruitment_company"));
    organizationMock.mockResolvedValue({ ...owner, displayName: "Manila Skills", type: "recruitment_company" });
    geographiesMock.mockResolvedValue({ sourcesFrom: ["AT"], servesMarket: ["DE"] });
    offerMock.mockResolvedValue(savedOffer);
    const html = await render(OnboardingPage);
    expect(currentStep(html)).toBe("Commitments");
    expect(html).toMatch(/Step 2 of 5: <\/span>Where you serve<span class="sr-only"> \(done\)<\/span>/);
    expect(html).toContain(">Next: Commitments</h1>");
    expect(html).toContain("Manila Skills, the countries where you serve and what you offer are saved.");
    expect(html).toContain('role="status"');
    expect(html).toMatch(/<a[^>]*href="\/en\/onboarding\?step=where-you-serve"[^>]*>Change where you serve/);
    expect(html).toMatch(/<a[^>]*href="\/en\/onboarding\?step=what-you-offer"[^>]*>Change what you offer/);

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
    expect(html).toContain(">Next: Commitments</h1>");
    expect(html).not.toContain("Change where you serve");
    expect(html).not.toContain("Change what you offer");
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
