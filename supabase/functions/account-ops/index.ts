import { serviceClient } from "../_shared/supabase.ts";
import { handleAccountOps } from "./handler.ts";

const client = serviceClient(Deno.env);
const sharedSecret = Deno.env.get("EDGE_SHARED_SECRET") ?? "";

Deno.serve((req) => handleAccountOps(req, { client, sharedSecret }));
