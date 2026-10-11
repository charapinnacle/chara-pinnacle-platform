"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DocumentTable } from "@/components/documents/document-table";
import { UploadForm } from "@/components/documents/upload-form";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { fetchDocuments, type DocumentItem } from "@/lib/documents/fetch-documents";
import { todayUtc } from "@/lib/validation/passport";

type Phase = "loading" | "ready" | "error";
type UploadType = "cv" | "certificate";

const uploadButtons = [
  { type: "cv", label: "Upload CV" },
  { type: "certificate", label: "Add certificate" },
] as const;

const SCAN_POLL_MS = 3000;

function loadFailed() {
  toastNetworkError("Could not load your documents");
}

export function DocumentsSection() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [uploading, setUploading] = useState<UploadType | null>(null);
  const router = useRouter();
  const shown = useRef(0);
  // Rows whose bytes this page failed to send: they are not being checked, whatever their age.
  const failed = useRef(new Set<string>());

  useEffect(() => {
    let current = true;
    fetchDocuments(null, shown.current).then(
      (page) => {
        if (!current) return;
        shown.current = page.items.length;
        setItems(page.items.map((item) => (failed.current.has(item.id) ? { ...item, checking: false } : item)));
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

  // The completeness meter above the list is rendered on the server and counts a CV once its scan has passed, so the page
  // asks for it again after each change and when a scan has ended.
  const reload = () => {
    setReloads((count) => count + 1);
    router.refresh();
  };

  // The scan runs a moment after the bytes arrive: the list asks again while a document is still being checked, and a
  // pending row stops counting as checked once it is older than the scan window.
  const waiting = items.some((item) => item.checking);
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (wasWaiting.current && !waiting) router.refresh();
    wasWaiting.current = waiting;
  }, [waiting, router]);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setReloads((count) => count + 1), SCAN_POLL_MS);
    return () => clearTimeout(timer);
  }, [waiting, items]);

  async function showMore() {
    const last = items.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const page = await fetchDocuments({ createdAt: last.createdAt, id: last.id });
      shown.current += page.items.length;
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
      <div className="flex flex-wrap gap-3">
        {uploadButtons.map(({ type, label }) => (
          <FormButton
            key={type}
            type="button"
            variant="secondary"
            className="w-auto"
            onClick={() => setUploading(type)}
          >
            {label}
          </FormButton>
        ))}
      </div>
      {uploading ? (
        <UploadForm key={uploading} initialType={uploading} onChanged={reload} onFailed={(id) => failed.current.add(id)} />
      ) : null}
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
        <EmptyState title="You have not uploaded any documents yet" description="Upload your CV or add a certificate with the buttons above." />
      ) : null}
      {phase === "ready" && items.length > 0 ? (
        <>
          <DocumentTable items={items} today={todayUtc()} onChanged={reload} />
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
