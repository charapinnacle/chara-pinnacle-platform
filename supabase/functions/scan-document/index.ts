import { serviceClient } from "../_shared/supabase.ts";
import { handleScanDocument } from "./handler.ts";

const client = serviceClient(Deno.env);
const sharedSecret = Deno.env.get("EDGE_SHARED_SECRET") ?? "";

Deno.serve((req) => handleScanDocument(req, { client, sharedSecret, fetch }));
