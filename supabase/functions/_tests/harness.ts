import { createClient } from "@supabase/supabase-js";

export interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

export type Route = (call: Call) => Response | Promise<Response> | undefined;

export function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// A real supabase-js client over a fake network: the paths, methods and bodies are what the platform would receive.
export function harness(routes: Record<string, Route | Response>) {
  const calls: Call[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const text = typeof init?.body === "string" ? init.body : "";
    const call: Call = {
      method,
      path: url.pathname,
      body: text ? JSON.parse(text) : null,
      headers: Object.fromEntries(new Headers(init?.headers)),
    };
    calls.push(call);
    const route = routes[`${method} ${url.pathname.replace(/[0-9a-f-]{36}/gi, "{id}")}`];
    const response = typeof route === "function" ? await route(call) : route?.clone();
    return await Promise.resolve(response ?? reply(404, { code: 404, error_code: "not_found", msg: "no route" }));
  };
  const client = createClient("http://stack.test", "service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fakeFetch },
  });
  return { calls, client, fetch: fakeFetch };
}
