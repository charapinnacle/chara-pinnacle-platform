const MAILPIT_API = "http://127.0.0.1:54424/api/v1";

interface MailpitMessage {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
}

interface SearchResult {
  messages: { ID: string }[];
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILPIT_API}${path}`);
  if (!response.ok) {
    throw new Error(`Mailpit ${path} answered ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function waitForMessage(
  to: string,
  { subject, timeoutMs = 15_000, intervalMs = 250 } = {} as {
    subject?: string;
    timeoutMs?: number;
    intervalMs?: number;
  },
): Promise<MailpitMessage> {
  const query = encodeURIComponent(
    subject ? `to:${to} subject:"${subject}"` : `to:${to}`,
  );
  const deadline = Date.now() + timeoutMs;
  do {
    const { messages } = await getJson<SearchResult>(
      `/search?query=${query}&limit=1`,
    );
    if (messages.length > 0) {
      return getJson<MailpitMessage>(`/message/${messages[0].ID}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);
  throw new Error(`No message for ${to} within ${timeoutMs} ms`);
}

export function extractLinks(message: MailpitMessage): string[] {
  const urls = `${message.HTML}\n${message.Text}`.match(
    /https?:\/\/[^\s"'<>]+/g,
  );
  return [
    ...new Set(
      (urls ?? []).map((url) =>
        url.replaceAll("&amp;", "&").replace(/[).,;]+$/, ""),
      ),
    ),
  ];
}

export async function messageCount(to: string): Promise<number> {
  const query = encodeURIComponent(`to:${to}`);
  const { messages } = await getJson<SearchResult>(
    `/search?query=${query}&limit=50`,
  );
  return messages.length;
}
