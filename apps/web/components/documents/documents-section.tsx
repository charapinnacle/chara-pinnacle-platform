"use client";

import { useEffect, useRef, useState } from "react";
import { DocumentTable } from "@/components/documents/document-table";
import { UploadForm } from "@/components/documents/upload-form";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { fetchDocuments, type DocumentItem } from "@/lib/documents/fetch-documents";
import { todayUtc } from "@/lib/validation/passport";

type Phase = "loading" | "ready" | "error";

const SCAN_POLL_MS = 2000;
const SCAN_POLL_LIMIT = 15;

function loadFailed() {
  toast({ variant: "error", title: "Could not load your documents", description: "Check your connection and try again." });
}

export function DocumentsSection() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const polls = useRef(0);

  useEffect(() => {
    let current = true;
    fetchDocuments(null).then(
      (page) => {
        if (!current) return;
        setItems(page.items);
        setHasMore(page.hasMore);
        setPhase("ready");
      },
      () => {
        if (!current) return;
        setPhase((before) => (before === "ready" ? before : "error"));
        loadFailed();
      },
    );
    return () => {
      current = false;
    };
  }, [reloads]);

  // The scan runs a moment after the bytes arrive: the list asks again for the documents this page uploaded.
  const waiting = items.some((item) => item.scanStatus === "pending" && uploaded.includes(item.id));
  useEffect(() => {
    if (!waiting || polls.current >= SCAN_POLL_LIMIT) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      setReloads((count) => count + 1);
    }, SCAN_POLL_MS);
    return () => clearTimeout(timer);
  }, [waiting, items]);

  const reload = () => setReloads((count) => count + 1);

  async function showMore() {
    const last = items.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const page = await fetchDocuments({ createdAt: last.createdAt, id: last.id });
      setItems((before) => [...before, ...page.items]);
      setHasMore(page.hasMore);
    } catch {
      loadFailed();
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-6">
      <UploadForm
        onChanged={reload}
        onUploaded={(id) => {
          polls.current = 0;
          setUploaded((ids) => [...ids, id]);
        }}
      />
      {phase === "loading" ? <LoadingSkeleton rows={3} /> : null}
      {phase === "error" ? (
        <EmptyState title="Your documents could not be loaded">
          <FormButton
            type="button"
            variant="secondary"
            onClick={() => {
              setPhase("loading");
              reload();
            }}
          >
            Retry
          </FormButton>
        </EmptyState>
      ) : null}
      {phase === "ready" && items.length === 0 ? (
        <EmptyState title="You have not uploaded any documents yet" description="Add your CV or a certificate with the form above." />
      ) : null}
      {phase === "ready" && items.length > 0 ? (
        <>
          <DocumentTable items={items} today={todayUtc()} checking={uploaded} onChanged={reload} />
          {hasMore ? (
            <FormButton type="button" variant="secondary" busy={loadingMore} onClick={showMore}>
              Show more documents
            </FormButton>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
