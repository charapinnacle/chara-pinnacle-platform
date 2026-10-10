import { exportLegalDocuments } from "@/lib/dal/admin-legal";
import { requirePlatformRole } from "@/lib/dal/session";

// The archive of every published version for an audit, as one JSON array. The role and the two-step level are checked
// before the first byte, and the first page is read before the response starts, so a failure there is an error and not
// a cut file; the database checks them again for every page.
export async function GET(_request: Request, { params }: RouteContext<"/[lang]/admin/legal/export">) {
  const { lang } = await params;
  await requirePlatformRole(lang, ["admin"]);

  const encoder = new TextEncoder();
  const pages = await exportLegalDocuments();
  let page = await pages.next();
  let first = true;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (page.done) {
        controller.enqueue(encoder.encode(first ? "[]" : "]"));
        controller.close();
        return;
      }
      const entries = page.value.map((entry) => JSON.stringify(entry)).join(",");
      controller.enqueue(encoder.encode(`${first ? "[" : ","}${entries}`));
      first = false;
      page = await pages.next();
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
