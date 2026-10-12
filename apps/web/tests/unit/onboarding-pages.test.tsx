import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.hoisted(() => vi.fn());
const organizationMock = vi.hoisted(() => vi.fn());
const twoStepMock = vi.hoisted(() => vi.fn());
const passportMock = vi.hoisted(() => vi.fn());
const welcomeDueMock = vi.hoisted(() => vi.fn());
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
vi.mock("@/lib/dal/organizations", () => ({ getMyOrganization: organizationMock }));
vi.mock("@/lib/dal/mfa", () => ({ hasVerifiedTotpFactor: twoStepMock }));
vi.mock("@/lib/dal/passport", () => ({ getPassport: passportMock }));
vi.mock("@/lib/dal/reference", () => ({
  getCountries: async () => [
    { code: "AT", name: "Austria" },
    { code: "DE", name: "Germany" },
  ],
  getIndustries: async () => [{ code: "F", name: "Construction" }],
}));
vi.mock("@/lib/dal/legal", () => ({ getOnboardingDocuments: vi.fn(), getSignUpForm: vi.fn() }));
vi.mock("@/lib/dal/team", () => ({ getInvitationPreview: vi.fn() }));
vi.mock("@/lib/invitation-cookie", () => ({ pendingInvitationToken: async () => null }));
vi.mock("@/lib/welcome-cookie", () => ({ welcomeIsDue: welcomeDueMock }));
vi.mock("@/lib/actions/organizations", () => ({ createOrganization: vi.fn() }));
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

async function render(page: PageComponent) {
  const { prelude } = await prerender(await page({ params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve({}) }));
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
}

const owner = { id: "org-1", slug: "acme-bau", displayName: "Acme Bau", role: "owner", suspended: false };
const currentStep = (html: string) => /<li aria-current="step"[^>]*>.*?Step \d of \d: <\/span>([^<]+)/.exec(html)?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  headerValues.acceptLanguage = null;
  requireUserMock.mockResolvedValue({ id: "user-1", email: "ana@example.test", accountKind: "company", intendedAccountKind: "company" });
  organizationMock.mockResolvedValue(null);
  twoStepMock.mockResolvedValue(false);
  passportMock.mockResolvedValue(null);
  welcomeDueMock.mockResolvedValue(true);
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

describe("the two-step set-up step of onboarding", () => {
  it("is step 2 of 3 for an owner without an authenticator, explains why and returns to the welcome screen", async () => {
    organizationMock.mockResolvedValue(owner);
    const html = await render(SecurityPage);
    expect(currentStep(html)).toBe("Security");
    expect(html).toMatch(/Step 1 of 3: <\/span>Company<span class="sr-only"> \(done\)<\/span>/);
    expect(html).toContain(
      "As the owner you can see applicants&#x27; documents and your company&#x27;s billing, so CHARA asks for a code from an authenticator app before you open them.",
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
    expect(html).toContain(">Welcome to CHARA Pinnacle, Acme Bau</h1>");
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
    expect(html).toContain(">Welcome to CHARA Pinnacle, Amira</h1>");
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
