import { MessagesSquare } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { TextLink } from "@/components/forms/text-link";
import { PageHeader } from "@/components/layout/page-header";
import { ConversationList } from "@/components/messaging/conversation-list";
import { getUnreadMessageCounts, listConversations } from "@/lib/dal/messaging";
import { conversationCursor, inboxContexts, type MessagingViewer } from "@/lib/messaging/present";
import { conversationPath, messagesPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { parseJobCursor } from "@/lib/validation/job";
import { parseInboxFilter, type PageContext } from "@/lib/validation/messaging";

const startText: Record<MessagingViewer["kind"], string> = {
  worker:
    "A conversation starts when an employer writes to you about one of your applications or a submission you approved, or when you write to them from it.",
  employer:
    "A conversation starts when your team or the other side chooses Message on an application, an approved submission, an accepted invitation or a response.",
  partner: "A conversation starts when your team or the employer chooses Message on an invitation you accepted or a response you sent.",
};

const filterLabels: Record<PageContext, string> = {
  application: "Applications",
  candidate_submission: "Submissions",
  requirement_invitation: "Invitations",
  partner_response: "Responses",
  contact_request: "Contact requests",
};

type InboxProps = {
  lang: string;
  viewer: MessagingViewer;
  userId: string;
  // The organisation of the inbox, or null for the candidate's own conversations.
  organizationId: string | null;
  context: PageContext | null;
  before: string | null;
};

async function Inbox({ lang, viewer, userId, organizationId, context, before }: InboxProps) {
  const slug = viewer.kind === "worker" ? null : viewer.slug;
  const cursor = parseJobCursor(before);
  const [{ items, hasMore }, unread] = await Promise.all([
    listConversations(organizationId, { context, before: cursor ? { at: cursor.createdAt, id: cursor.id } : null }),
    getUnreadMessageCounts(),
  ]);
  const first = cursor ? messagesPath(lang, slug, { context }) : null;

  if (items.length === 0) {
    return (
      <div role="status">
        {first ? (
          <EmptyState icon={MessagesSquare} title="No more conversations">
            <TextLink standalone href={first}>
              Back to the newest conversations
            </TextLink>
          </EmptyState>
        ) : context ? (
          <EmptyState icon={MessagesSquare} title={`No conversations about ${filterLabels[context].toLowerCase()}`}>
            <TextLink standalone href={messagesPath(lang, slug)}>
              Show all conversations
            </TextLink>
          </EmptyState>
        ) : (
          <EmptyState icon={MessagesSquare} title="No conversations yet" description={startText[viewer.kind]} />
        )}
      </div>
    );
  }

  const last = items.at(-1);
  return (
    <div className="grid gap-4">
      <ConversationList
        userId={userId}
        side={organizationId}
        items={items.map((item) => ({ ...item, href: conversationPath(lang, slug, item.id) }))}
        initialUnread={unread}
      />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {hasMore && last ? (
          <TextLink standalone href={messagesPath(lang, slug, { context, before: conversationCursor(last) })}>
            Older conversations
          </TextLink>
        ) : null}
        {first ? (
          <TextLink standalone href={first}>
            Back to the newest conversations
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}

type MessagesInboxProps = Omit<InboxProps, "context" | "before"> & {
  breadcrumb?: React.ReactNode;
  searchParams: Record<string, string | string[] | undefined>;
};

// The inbox of the candidate or of one organisation (FR-P1 AC10, SOP P2-26 step Members): the filter by context in the
// address, then the conversations, latest message first, a page at a time.
export function MessagesInbox({ lang, viewer, userId, organizationId, breadcrumb, searchParams }: MessagesInboxProps) {
  const slug = viewer.kind === "worker" ? null : viewer.slug;
  const context = parseInboxFilter(searchParams.context);
  const before = typeof searchParams.before === "string" ? searchParams.before : null;
  const filters = [null, ...inboxContexts(viewer)];

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Messages"
        description={
          viewer.kind === "worker"
            ? "Your conversations with employers, latest message first."
            : "The conversations of your organisation, latest message first. Every member reads and writes them."
        }
        breadcrumb={breadcrumb}
      />
      <nav aria-label="Filter by context">
        <ul className="flex flex-wrap gap-2">
          {filters.map((filter) => {
            const current = filter === context;
            return (
              <li key={filter ?? "all"}>
                <Link
                  href={messagesPath(lang, slug, { context: filter })}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-full border px-4 text-small font-medium transition-colors duration-150 hover:bg-secondary",
                    current && "border-primary bg-primary text-primary-foreground hover:bg-primary",
                  )}
                >
                  {filter ? filterLabels[filter] : "All"}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <Suspense key={`${context ?? "all"}|${before ?? ""}`} fallback={<LoadingSkeleton rows={4} />}>
        <Inbox lang={lang} viewer={viewer} userId={userId} organizationId={organizationId} context={context} before={before} />
      </Suspense>
    </div>
  );
}
