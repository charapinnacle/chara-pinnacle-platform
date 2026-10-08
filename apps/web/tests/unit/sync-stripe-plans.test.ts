import { describe, expect, it } from "vitest";
import { stripeApi, syncPlans } from "../../../../scripts/sync-stripe-plans.mjs";

const PLANS = [
  { code: "free_employer", name: "Free", price_minor: 0, currency: "EUR", interval: "month", is_public: false, contact_sales: false, sort: 0 },
  { code: "employer_starter", name: "Basic", price_minor: 3900, currency: "EUR", interval: "month", is_public: true, contact_sales: false, sort: 1 },
  { code: "employer_professional", name: "Professional", price_minor: 7900, currency: "EUR", interval: "month", is_public: true, contact_sales: false, sort: 2 },
  { code: "employer_enterprise", name: "Enterprise", price_minor: 0, currency: "EUR", interval: "month", is_public: false, contact_sales: true, sort: 3 },
];

type Product = { id: string; name: string; metadata: Record<string, string> };
type Price = {
  id: string;
  product: string;
  unit_amount: number;
  currency: string;
  tax_behavior: string;
  recurring: { interval: string };
  metadata: Record<string, string>;
  active: boolean;
};
type Plan = (typeof PLANS)[number];

// A Stripe account as a snapshot that the script reads and changes. failOn names the call that fails, counted from 1.
function stubStripe(failOn?: { call: "createProduct" | "createPrice"; plan: string }) {
  const products: Product[] = [];
  const prices: Price[] = [];
  const calls: string[] = [];
  const stripe = {
    listProducts: async () => products.map((product) => ({ ...product })),
    listPrices: async () => prices.filter((price) => price.active).map((price) => ({ ...price })),
    createProduct: async (plan: object) => {
      const { code, name } = plan as Plan;
      if (failOn?.call === "createProduct" && failOn.plan === code) throw new Error("Stripe answered 500 to POST /products");
      const product = { id: `prod_${products.length + 1}`, name, metadata: { plan_code: code } };
      products.push(product);
      calls.push(`createProduct ${code}`);
      return product;
    },
    renameProduct: async (id: string, name: string) => {
      const product = products.find((candidate) => candidate.id === id)!;
      product.name = name;
      calls.push(`renameProduct ${product.metadata.plan_code}`);
    },
    createPrice: async (plan: object, productId: string) => {
      const { code, price_minor } = plan as Plan;
      if (failOn?.call === "createPrice" && failOn.plan === code) throw new Error("Stripe answered 500 to POST /prices");
      const price: Price = {
        id: `price_${prices.length + 1}`,
        product: productId,
        unit_amount: price_minor,
        currency: "eur",
        tax_behavior: "exclusive",
        recurring: { interval: "month" },
        metadata: { plan_code: code },
        active: true,
      };
      prices.push(price);
      calls.push(`createPrice ${code} ${price_minor}`);
      return price;
    },
    archivePrice: async (id: string) => {
      const price = prices.find((candidate) => candidate.id === id)!;
      price.active = false;
      calls.push(`archivePrice ${price.metadata.plan_code}`);
    },
  };
  return { stripe, products, prices, calls };
}

// The table billing.plan_provider_refs as the script writes it.
function stubStore() {
  const refs: Record<string, { product?: string | null; price?: string | null }> = {};
  const writes: string[] = [];
  return {
    refs,
    writes,
    store: {
      saveProduct: async (code: string, id: string) => {
        refs[code] = { product: id, price: null };
        writes.push(`product ${code}`);
      },
      savePrice: async (code: string, id: string) => {
        refs[code] = { ...refs[code], price: id };
        writes.push(`price ${code}`);
      },
    },
  };
}

describe("the Stripe mirror of the plans (FR-G1 AC10)", () => {
  it("creates one product and one monthly EUR price per sold plan, and stores their identifiers", async () => {
    const stripe = stubStripe();
    const database = stubStore();
    const changes = await syncPlans({ plans: PLANS, refs: database.refs, stripe: stripe.stripe, store: database.store });

    expect(changes).toEqual([
      "created the product of employer_starter",
      "created a price of employer_starter at 3900",
      "created the product of employer_professional",
      "created a price of employer_professional at 7900",
    ]);
    expect(stripe.products.map((product) => [product.name, product.metadata.plan_code])).toEqual([
      ["Basic", "employer_starter"],
      ["Professional", "employer_professional"],
    ]);
    expect(stripe.prices.map((price) => [price.metadata.plan_code, price.unit_amount, price.currency, price.recurring.interval, price.tax_behavior])).toEqual([
      ["employer_starter", 3900, "eur", "month", "exclusive"],
      ["employer_professional", 7900, "eur", "month", "exclusive"],
    ]);
    expect(database.refs).toEqual({
      employer_starter: { product: "prod_1", price: "price_1" },
      employer_professional: { product: "prod_2", price: "price_2" },
    });
  });

  it("makes no change on a second run", async () => {
    const stripe = stubStripe();
    const database = stubStore();
    await syncPlans({ plans: PLANS, refs: database.refs, stripe: stripe.stripe, store: database.store });
    const callsBefore = stripe.calls.length;
    database.writes.length = 0;

    const changes = await syncPlans({ plans: PLANS, refs: database.refs, stripe: stripe.stripe, store: database.store });
    expect(changes).toEqual([]);
    expect(stripe.calls).toHaveLength(callsBefore);
    expect(database.writes).toEqual([]);
  });

  it("creates one new price when the amount changes, archives the old one and stores the new identifier", async () => {
    const stripe = stubStripe();
    const database = stubStore();
    await syncPlans({ plans: PLANS, refs: database.refs, stripe: stripe.stripe, store: database.store });
    const raised = PLANS.map((plan) => (plan.code === "employer_starter" ? { ...plan, price_minor: 4200 } : plan));
    stripe.calls.length = 0;
    database.writes.length = 0;

    const changes = await syncPlans({ plans: raised, refs: database.refs, stripe: stripe.stripe, store: database.store });
    expect(changes).toEqual(["created a price of employer_starter at 4200", "archived a price of employer_starter"]);
    expect(stripe.calls).toEqual(["createPrice employer_starter 4200", "archivePrice employer_starter"]);
    expect(stripe.prices.filter((price) => price.active).map((price) => [price.metadata.plan_code, price.unit_amount])).toEqual([
      ["employer_professional", 7900],
      ["employer_starter", 4200],
    ]);
    expect(database.refs.employer_starter).toEqual({ product: "prod_1", price: "price_3" });
    expect(database.writes).toEqual(["price employer_starter"]);
  });

  it("keeps the identifier of the plan it created when a later call fails, and the next run adds only what is missing", async () => {
    const stripe = stubStripe({ call: "createProduct", plan: "employer_professional" });
    const database = stubStore();
    await expect(syncPlans({ plans: PLANS, refs: database.refs, stripe: stripe.stripe, store: database.store })).rejects.toThrow(
      "Stripe answered 500",
    );
    expect(database.refs).toEqual({ employer_starter: { product: "prod_1", price: "price_1" } });

    const healthy = stubStripe();
    healthy.products.push(...stripe.products);
    healthy.prices.push(...stripe.prices);
    const changes = await syncPlans({ plans: PLANS, refs: database.refs, stripe: healthy.stripe, store: database.store });
    expect(changes).toEqual(["created the product of employer_professional", "created a price of employer_professional at 7900"]);
    expect(database.refs.employer_professional).toEqual({ product: "prod_2", price: "price_2" });
  });

  it("keeps the product when only the price fails, and creates just the price next time", async () => {
    const stripe = stubStripe({ call: "createPrice", plan: "employer_starter" });
    const database = stubStore();
    await expect(syncPlans({ plans: PLANS, refs: database.refs, stripe: stripe.stripe, store: database.store })).rejects.toThrow();
    expect(database.refs).toEqual({ employer_starter: { product: "prod_1", price: null } });

    const healthy = stubStripe();
    healthy.products.push(...stripe.products);
    const changes = await syncPlans({ plans: PLANS, refs: database.refs, stripe: healthy.stripe, store: database.store });
    expect(changes).toEqual([
      "created a price of employer_starter at 3900",
      "created the product of employer_professional",
      "created a price of employer_professional at 7900",
    ]);
  });

  it("adopts what Stripe already holds when the identifiers were never stored, without creating anything", async () => {
    const stripe = stubStripe();
    const first = stubStore();
    await syncPlans({ plans: PLANS, refs: first.refs, stripe: stripe.stripe, store: first.store });
    const lost = stubStore();
    stripe.calls.length = 0;

    const changes = await syncPlans({ plans: PLANS, refs: lost.refs, stripe: stripe.stripe, store: lost.store });
    expect(changes).toEqual([]);
    expect(stripe.calls).toEqual([]);
    expect(lost.refs).toEqual(first.refs);
  });

  it("renames the product when the plan is renamed, and replaces a price that was archived by hand", async () => {
    const stripe = stubStripe();
    const database = stubStore();
    await syncPlans({ plans: PLANS, refs: database.refs, stripe: stripe.stripe, store: database.store });
    stripe.prices[0].active = false;
    const renamed = PLANS.map((plan) => (plan.code === "employer_starter" ? { ...plan, name: "Standard" } : plan));

    const changes = await syncPlans({ plans: renamed, refs: database.refs, stripe: stripe.stripe, store: database.store });
    expect(changes).toEqual(["renamed the product of employer_starter", "created a price of employer_starter at 3900"]);
    expect(stripe.products[0].name).toBe("Standard");
    expect(database.refs.employer_starter?.price).toBe("price_3");
  });

  it("never creates anything for a plan that is not sold", async () => {
    const stripe = stubStripe();
    const database = stubStore();
    const changes = await syncPlans({
      plans: PLANS.filter((plan) => !plan.is_public),
      refs: database.refs,
      stripe: stripe.stripe,
      store: database.store,
    });
    expect(changes).toEqual([]);
    expect(stripe.products).toEqual([]);
  });
});

describe("the Stripe client of the script", () => {
  function recording(pages: unknown[]) {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), init: init ?? {} });
      const page = pages.shift();
      return page instanceof Response ? page : Response.json(page);
    };
    return { seen, fetchFn };
  }

  it("reads every page of the list and sends the key", async () => {
    const { seen, fetchFn } = recording([
      { data: [{ id: "prod_1" }, { id: "prod_2" }], has_more: true },
      { data: [{ id: "prod_3" }], has_more: false },
    ]);
    const products = await stripeApi("sk_test_key", fetchFn).listProducts();
    expect(products.map((product: { id: string }) => product.id)).toEqual(["prod_1", "prod_2", "prod_3"]);
    expect(seen.map((call) => call.url)).toEqual([
      "https://api.stripe.com/v1/products?active=true&limit=100",
      "https://api.stripe.com/v1/products?active=true&limit=100&starting_after=prod_2",
    ]);
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe("Bearer sk_test_key");
  });

  it("creates a price exclusive of VAT with the plan code and a stable idempotency key", async () => {
    const { seen, fetchFn } = recording([{ id: "price_1" }]);
    await stripeApi("sk_test_key", fetchFn).createPrice(PLANS[1], "prod_1");
    expect(Object.fromEntries(new URLSearchParams(seen[0].init.body as string))).toEqual({
      product: "prod_1",
      currency: "eur",
      unit_amount: "3900",
      "recurring[interval]": "month",
      tax_behavior: "exclusive",
      "metadata[plan_code]": "employer_starter",
    });
    expect((seen[0].init.headers as Record<string, string>)["idempotency-key"]).toBe("chara-price-employer_starter-3900-EUR-month");
  });

  it("fails with the status and the path only, never the key", async () => {
    const { fetchFn } = recording([new Response('{"error":{"message":"Invalid API Key provided: sk_test_key"}}', { status: 401 })]);
    const failure = await stripeApi("sk_test_key", fetchFn).listPrices().then(() => null, (error: Error) => error);
    expect(failure?.message).toBe("Stripe answered 401 to GET /prices");
  });
});
