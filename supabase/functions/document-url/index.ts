import { serviceClient, userClient } from "../_shared/supabase.ts";
import { handleDocumentUrl } from "./handler.ts";

const signer = serviceClient(Deno.env);

Deno.serve((req) =>
  handleDocumentUrl(req, { userClient: (authorization) => userClient(Deno.env, authorization), signer })
);
