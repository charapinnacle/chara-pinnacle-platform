import { assertAppOrigin, type BillingProvider } from "../provider.ts";

// For the local stack and CI: no account and no network. The hosted pages are addresses on a host that cannot exist
// (RFC 6761), so a test can intercept the redirect and nothing leaves the machine.
const HOSTED = "https://null-provider.invalid";

export function nullProvider(siteUrl: string): BillingProvider {
  return {
    name: "null",
    createCheckout(input) {
      return Promise.resolve().then(() => {
        assertAppOrigin(siteUrl, input.successUrl, input.cancelUrl);
        const query = new URLSearchParams({ success_url: input.successUrl, cancel_url: input.cancelUrl });
        return { url: `${HOSTED}/checkout/null_cs_${crypto.randomUUID()}?${query}` };
      });
    },
    createPortal(input) {
      return Promise.resolve().then(() => {
        assertAppOrigin(siteUrl, input.returnUrl);
        const query = new URLSearchParams({ return_url: input.returnUrl });
        return { url: `${HOSTED}/portal/${encodeURIComponent(input.customerRef)}?${query}` };
      });
    },
  };
}
