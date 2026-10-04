import type { Page } from "@playwright/test";

export interface ActionCall {
  id: string;
  contentType: string;
  body: string;
  status: () => number | undefined;
}

export function captureActionRequests(page: Page): ActionCall[] {
  const calls: ActionCall[] = [];
  page.on("request", (request) => {
    const headers = request.headers();
    const id = headers["next-action"];
    if (request.method() === "POST" && id) {
      let status: number | undefined;
      void request.response().then((response) => {
        status = response?.status();
      });
      calls.push({
        id,
        contentType: headers["content-type"],
        body: request.postData() ?? "",
        status: () => status,
      });
    }
  });
  return calls;
}
