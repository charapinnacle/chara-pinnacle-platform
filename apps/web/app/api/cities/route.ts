import type { NextRequest } from "next/server";
import * as z from "zod";
import { suggestCities } from "@/lib/dal/reference";

const params = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  q: z.string().max(100).default(""),
});

// The City field of the home search reads its suggestions here with a plain fetch, so that the home page loads no
// Supabase client. The answer is the same for every visitor, so browsers and the CDN keep it for a few minutes; a
// city that gains its first vacancy moves to the top within that time.
export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const parsed = params.safeParse({ country: search.get("country") ?? undefined, q: search.get("q") ?? undefined });
  if (!parsed.success) return Response.json({ cities: [] }, { status: 400, headers: { "cache-control": "no-store" } });
  try {
    const cities = await suggestCities(parsed.data.country, parsed.data.q);
    return Response.json(
      { cities },
      { headers: { "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600" } },
    );
  } catch (error) {
    console.error("The city suggestions could not be loaded", error);
    return Response.json({ cities: [] }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
