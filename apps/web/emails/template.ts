import type { ReactElement } from "react";
import type { Payload } from "./payload.ts";

export interface Template {
  subject: (payload: Payload) => string;
  Body: (props: { payload: Payload; siteUrl: string }) => ReactElement;
}
