import { exportLegalDocuments } from "@/lib/dal/admin-legal";
import { requirePlatformRole } from "@/lib/dal/session";

// The archive of every published version for an audit, as one JSON array. The role and the two-step level are checked
// before the first byte; the database checks them again for every page.
export async function GET(_request: Request, { params }: RouteContext<"/[lang]/admin/legal/export">) {
  const { lang } = await params;
  await requirePlatformRole(lang, ["admin"]);

  const encoder = new TextEncoder();
  const pages = await exportLegalDocuments();
  let first = true;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await pages.next();
      if (done) {
        controller.enqueue(encoder.encode(first ? "[]" : "]"));
        controller.close();
        return;
      }
      const entries = value.map((entry) => JSON.stringify(entry)).join(",");
      controller.enqueue(encoder.encode(`${first ? "[" : ","}${entries}`));
      first = false;
    },
    async cancel() {
      await pages.return(undefined);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="legal-documents-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
