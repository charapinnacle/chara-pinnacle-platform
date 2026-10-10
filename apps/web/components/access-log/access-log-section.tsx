"use client";

import { useEffect, useRef, useState } from "react";
import { AccessLogTable } from "@/components/access-log/access-log-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { fetchAccessLog, type AccessLogCursor, type AccessLogItem } from "@/lib/access-log/fetch-access-log";

type Phase = "loading" | "ready" | "error";

export function AccessLogSection() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<AccessLogItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  // Where each page after the first starts; the last entry is the page on screen.
  const [trail, setTrail] = useState<AccessLogCursor[]>([]);
  const [navigating, setNavigating] = useState(false);
  const [reloads, setReloads] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);

  useEffect(() => {
    let current = true;
    fetchAccessLog(trail.at(-1) ?? null).then(
      (page) => {
        if (!current) return;
        setItems(page.items);
        setHasMore(page.hasMore);
        setPhase("ready");
        setNavigating(false);
      },
      () => {
        if (!current) return;
        setPhase("error");
        setNavigating(false);
        toastNetworkError("Could not load the access log");
      },
    );
    return () => {
      current = false;
    };
  }, [trail, reloads]);

  // The rows are replaced, so a keyboard user who pressed a page button would lose their place: focus moves to the table.
  useEffect(() => {
    if (phase === "ready" && !navigating && refocus.current) {
      refocus.current = false;
      list.current?.focus();
    }
  }, [phase, navigating, items]);

  function go(next: AccessLogCursor[]) {
    refocus.current = true;
    setNavigating(true);
    setTrail(next);
  }

  const last = items.at(-1);

  return (
    <div className="grid min-w-0 gap-4">
      {phase === "loading" ? <LoadingSkeleton rows={3} /> : null}
      {phase === "error" ? (
        <EmptyState title="Your access log could not be loaded">
          <FormButton
            type="button"
            variant="secondary"
            onClick={() => {
              setPhase("loading");
              setReloads((count) => count + 1);
            }}
          >
            Retry
          </FormButton>
          {trail.length > 0 ? (
            <FormButton
              type="button"
              variant="secondary"
              onClick={() => {
                setPhase("loading");
                go(trail.slice(0, -1));
              }}
            >
              Previous page
            </FormButton>
          ) : null}
        </EmptyState>
      ) : null}
      {phase === "ready" && items.length === 0 ? (
        <EmptyState
          title="No organisation has opened your documents yet"
          description="When an organisation opens a document you shared with an application, it is listed here."
        />
      ) : null}
      {phase === "ready" && items.length > 0 ? (
        <>
          <div ref={list} tabIndex={-1} className="min-w-0 outline-none">
            <AccessLogTable items={items} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {trail.length > 0 ? (
              <FormButton type="button" variant="secondary" busy={navigating} onClick={() => go(trail.slice(0, -1))}>
                Previous page
              </FormButton>
            ) : null}
            <p aria-live="polite" className="text-body text-muted-foreground">
              Page {trail.length + 1}
            </p>
            {hasMore && last ? (
              <FormButton
                type="button"
                variant="secondary"
                busy={navigating}
                onClick={() => go([...trail, { accessedAt: last.accessedAt, id: last.id }])}
              >
                Next page
              </FormButton>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
