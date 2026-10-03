export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { buildId: process.env.NEXT_DEPLOYMENT_ID || "unversioned" },
    { headers: { "cache-control": "no-store" } },
  );
}
