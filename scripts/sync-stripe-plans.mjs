#!/usr/bin/env node
// Mirrors the sold plans of billing.plans to Stripe (FR-G1 AC10): one product and one monthly EUR price, exclusive of
// VAT, per plan, with the plan code in the metadata of both, and stores their identifiers in billing.plan_provider_refs.
// It reads Stripe first and creates only what is missing, so a run that stopped halfway, or a second run, adds nothing
// twice. A price is never edited (Stripe does not allow it): a new amount creates a new price and archives the old one.
//
// Usage: DATABASE_URL=... STRIPE_SECRET_KEY=... node scripts/sync-stripe-plans.mjs [--export]
// DATABASE_URL is the direct connection of an operator who is a member of billing_owner (never the Data API or an Edge
// Function); psql must be installed. --export changes nothing and prints, for the go-live check, the
// plans with their limits, their stored price reference and the amount Stripe holds for it (docs/runbooks/checkout.md).
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const STRIPE_API = "https://api.stripe.com/v1";

export function isSold(plan) {
  return plan.is_public && !plan.contact_sales && plan.price_minor > 0;
}

function priceMatches(price, plan) {
  return (
    price.unit_amount === plan.price_minor &&
    price.currency === plan.currency.toLowerCase() &&
    price.recurring?.interval === plan.interval &&
    price.tax_behavior === "exclusive"
  );
}

/**
 * @param {{
 *   plans: { code: string, name: string, price_minor: number, currency: string, interval: string, is_public: boolean, contact_sales: boolean, sort: number }[],
 *   refs: Record<string, { product?: string | null, price?: string | null }>,
 *   stripe: {
 *     listProducts(): Promise<{ id: string, name: string, metadata?: Record<string, string> }[]>,
 *     listPrices(): Promise<{ id: string, product: string, unit_amount: number, currency: string, tax_behavior?: string, recurring?: { interval: string }, metadata?: Record<string, string> }[]>,
 *     createProduct(plan: object): Promise<{ id: string }>,
 *     renameProduct(id: string, name: string): Promise<unknown>,
 *     createPrice(plan: object, productId: string): Promise<{ id: string }>,
 *     archivePrice(id: string): Promise<unknown>,
 *   },
 *   store: { saveProduct(code: string, id: string): Promise<void>, savePrice(code: string, id: string): Promise<void> },
 * }} options
 * @returns {Promise<string[]>} what was changed at Stripe, empty when nothing was
 */
export async function syncPlans({ plans, refs, stripe, store }) {
  const [products, prices] = await Promise.all([stripe.listProducts(), stripe.listPrices()]);
  const changes = [];
  for (const plan of plans.filter(isSold).toSorted((a, b) => a.sort - b.sort)) {
    const stored = refs[plan.code] ?? {};
    let product = products.find((candidate) => candidate.metadata?.plan_code === plan.code);
    if (!product) {
      product = await stripe.createProduct(plan);
      changes.push(`created the product of ${plan.code}`);
    } else if (product.name !== plan.name) {
      await stripe.renameProduct(product.id, plan.name);
      changes.push(`renamed the product of ${plan.code}`);
    }
    if (stored.product !== product.id) {
      await store.saveProduct(plan.code, product.id);
    }

    const live = prices.filter((price) => price.product === product.id && price.metadata?.plan_code === plan.code);
    let price = live.find((candidate) => priceMatches(candidate, plan));
    if (!price) {
      price = await stripe.createPrice(plan, product.id);
      changes.push(`created a price of ${plan.code} at ${plan.price_minor}`);
    }
    if (stored.price !== price.id) {
      await store.savePrice(plan.code, price.id);
    }
    for (const old of live.filter((candidate) => candidate.id !== price.id)) {
      await stripe.archivePrice(old.id);
      changes.push(`archived a price of ${plan.code}`);
    }
  }
  return changes;
}

export function stripeApi(secretKey, fetchFn = fetch) {
  async function call(method, path, params) {
    const headers = { authorization: `Bearer ${secretKey}` };
    if (params) {
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    const response = await fetchFn(`${STRIPE_API}${path}`, {
      method,
      headers: params?.idempotencyKey ? { ...headers, "idempotency-key": params.idempotencyKey } : headers,
      body: params?.body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Stripe answered ${response.status} to ${method} ${path.split("?")[0]}`);
    }
    return response.json();
  }

  const write = (path, fields, idempotencyKey) =>
    call("POST", path, { body: new URLSearchParams(fields).toString(), idempotencyKey });

  async function list(path) {
    const items = [];
    for (let after = null; ; ) {
      const page = await call("GET", `${path}${after ? `&starting_after=${after}` : ""}`);
      items.push(...page.data);
      if (!page.has_more) {
        return items;
      }
      after = page.data.at(-1).id;
    }
  }

  return {
    listProducts: () => list("/products?active=true&limit=100"),
    listPrices: () => list("/prices?active=true&limit=100"),
    getPrice: (id) => call("GET", `/prices/${encodeURIComponent(id)}`),
    createProduct: (plan) =>
      write("/products", { name: plan.name, "metadata[plan_code]": plan.code }, `chara-product-${plan.code}-${plan.name}`),
    renameProduct: (id, name) => write(`/products/${encodeURIComponent(id)}`, { name }),
    createPrice: (plan, productId) =>
      write(
        "/prices",
        {
          product: productId,
          currency: plan.currency.toLowerCase(),
          unit_amount: String(plan.price_minor),
          "recurring[interval]": plan.interval,
          tax_behavior: "exclusive",
          "metadata[plan_code]": plan.code,
        },
        `chara-price-${plan.code}-${plan.price_minor}-${plan.currency}-${plan.interval}`,
      ),
    archivePrice: (id) => write(`/prices/${encodeURIComponent(id)}`, { active: "false" }),
  };
}

// The database half. Values travel as psql variables, quoted by psql itself, never spliced into the statement.
function psql(databaseUrl, sql, variables = {}) {
  const args = [databaseUrl, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
  for (const [name, value] of Object.entries(variables)) {
    args.push("-v", `${name}=${value}`);
  }
  try {
    return execFileSync("psql", args, { input: `set role billing_owner;\n${sql}`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    // The message of execFileSync names the command line, which holds the password of the connection.
    throw new Error(`The database call failed: ${String(error.stderr ?? "").trim().split("\n")[0] || "psql did not run"}`);
  }
}

function databaseStore(databaseUrl) {
  return {
    async saveProduct(code, id) {
      psql(
        databaseUrl,
        `insert into billing.plan_provider_refs (plan_code, provider, provider_product_ref)
         values (:'code', 'stripe', :'ref')
         on conflict (plan_code, provider) do update set provider_product_ref = excluded.provider_product_ref, provider_price_ref = null;`,
        { code, ref: id },
      );
    },
    async savePrice(code, id) {
      psql(
        databaseUrl,
        `update billing.plan_provider_refs set provider_price_ref = :'ref' where plan_code = :'code' and provider = 'stripe';`,
        { code, ref: id },
      );
    },
  };
}

function loadState(databaseUrl) {
  const out = psql(
    databaseUrl,
    `select json_build_object(
       'plans', (select coalesce(json_agg(json_build_object(
          'code', p.code, 'name', p.name, 'price_minor', p.price_minor, 'currency', p.currency, 'interval', p.interval,
          'is_public', p.is_public, 'contact_sales', p.contact_sales, 'sort', p.sort,
          'limits', (select coalesce(json_object_agg(l.limit_key, l.limit_value), '{}') from billing.plan_limits l where l.plan_code = p.code)
        ) order by p.sort), '[]') from billing.plans p),
       'refs', (select coalesce(json_object_agg(r.plan_code, json_build_object('product', r.provider_product_ref, 'price', r.provider_price_ref)), '{}')
                from billing.plan_provider_refs r where r.provider = 'stripe')
     );`,
  );
  return JSON.parse(out);
}

async function exportPlans(state, stripe) {
  const plans = [];
  for (const plan of state.plans) {
    const priceRef = state.refs[plan.code]?.price ?? null;
    let stripeAmount = null;
    if (isSold(plan) && priceRef) {
      const price = await stripe.getPrice(priceRef).catch(() => null);
      stripeAmount = price?.active ? price.unit_amount : null;
    }
    plans.push({
      code: plan.code,
      is_public: plan.is_public,
      contact_sales: plan.contact_sales,
      price_minor: plan.price_minor,
      limits: plan.limits,
      price_ref: priceRef,
      stripe_amount: stripeAmount,
    });
  }
  return { plans };
}

async function main(argv, env) {
  const databaseUrl = env.DATABASE_URL;
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!databaseUrl || !secretKey) {
    process.stderr.write("Usage: DATABASE_URL=... STRIPE_SECRET_KEY=... node scripts/sync-stripe-plans.mjs [--export]\n");
    return 2;
  }
  try {
    const state = loadState(databaseUrl);
    const stripe = stripeApi(secretKey);
    if (argv.includes("--export")) {
      process.stdout.write(`${JSON.stringify(await exportPlans(state, stripe), null, 2)}\n`);
      return 0;
    }
    const changes = await syncPlans({ plans: state.plans, refs: state.refs, stripe, store: databaseStore(databaseUrl) });
    process.stdout.write(changes.length ? `${changes.join("\n")}\n` : "Stripe already mirrors the plans: nothing changed\n");
    return 0;
  } catch (error) {
    process.stderr.write(`Mirroring the plans failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
