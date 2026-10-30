"use client";

import { FileText } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { StatusBadge } from "@/components/feedback/status-badge";
import { toastError } from "@/components/feedback/toast-store";
import { controlClassName } from "@/components/forms/control-class";
import { FormButton } from "@/components/forms/form-button";
import { Input } from "@/components/ui/input";
import { readResponseDocuments, removeResponseDocument, startResponseDocumentUpload } from "@/lib/actions/responses";
import type { DocumentScanStatus, ResponseDocument } from "@/lib/dal/responses";
import { formatFileSize } from "@/lib/documents/presentation";
import { documentsLimitText } from "@/lib/responses/presentation";
import type { StatusTone } from "@/lib/status-tone";
import { cn } from "@/lib/utils";
import { DOCUMENT_TYPE, documentFileIssue } from "@/lib/validation/response";

const POLL_MS = 3_000;
const POLL_ROUNDS = 40;

const scanLabels: Record<DocumentScanStatus, string> = {
  pending: "Being checked",
  skipped: "Ready",
  clean: "Ready",
  rejected: "Refused: not a valid PDF",
};

const scanTones: Record<DocumentScanStatus, StatusTone> = {
  pending: "info",
  skipped: "success",
  clean: "success",
  rejected: "danger",
};

type Upload = { key: string; name: string; percent: number };

// Sends the bytes straight to the signed upload URL, as supabase-js does, but with XMLHttpRequest, whose upload events
// give the progress that fetch does not.
function sendFile(url: string, file: File, onProgress: (percent: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("content-type", DOCUMENT_TYPE);
    request.setRequestHeader("cache-control", "max-age=3600");
    request.setRequestHeader("x-upsert", "false");
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (key) request.setRequestHeader("apikey", key);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => resolve(request.status >= 200 && request.status < 300);
    request.onerror = () => resolve(false);
    request.onabort = () => resolve(false);
    request.send(file);
  });
}

type ResponseDocumentsProps = {
  slug: string;
  requirementId: string;
  initial: ResponseDocument[];
  max: number;
};

// The supporting PDFs of the response (FR-O2 step Attach, AC5): chosen one or several at a time, checked here for the
// type, the size, the name and the limit before an upload URL is asked for, sent with their progress, then followed until
// the scan answers (Being checked, Ready, or Refused when the file is not a PDF). Before the partner responds the files
// wait staged on the requirement and the response takes them; on a live response a file belongs to it at once. A file
// can be removed while it may change. Rejected files do not count against the limit.
export function ResponseDocuments({ slug, requirementId, initial, max }: ResponseDocumentsProps) {
  const id = useId();
  const [documents, setDocuments] = useState(initial);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [problem, setProblem] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [rounds, setRounds] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = documents.some((document) => document.scanStatus === "pending");
  const counted = documents.filter((document) => document.scanStatus !== "rejected").length + uploads.length;

  useEffect(() => {
    if (!pending || rounds >= POLL_ROUNDS) return;
    const timer = setTimeout(async () => {
      const result = await readResponseDocuments(slug, requirementId).catch(() => null);
      if (result?.documents) {
        const before = new Map(documents.map((document) => [document.id, document.scanStatus]));
        const done = result.documents.filter((document) => before.get(document.id) === "pending" && document.scanStatus !== "pending");
        if (done.length > 0) setAnnouncement(done.map((document) => `${document.fileName}: ${scanLabels[document.scanStatus]}.`).join(" "));
        setDocuments(result.documents);
      }
      setRounds((value) => value + 1);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [pending, rounds, documents, slug, requirementId]);

  async function upload(file: File, attached: number): Promise<boolean> {
    const issue = documentFileIssue(file, attached, max);
    if (issue) {
      setProblem(`${file.name}: ${issue}`);
      return false;
    }
    const key = `${file.name}-${Date.now()}`;
    setUploads((list) => [...list, { key, name: file.name, percent: 0 }]);
    try {
      const started = await startResponseDocumentUpload(slug, requirementId, { name: file.name, size: file.size, type: file.type });
      if (!started.upload) {
        setProblem(`${file.name}: ${started.message ?? "The file could not be sent."}`);
        return false;
      }
      const { url, documentId } = started.upload;
      const sent = await sendFile(url, file, (percent) =>
        setUploads((list) => list.map((item) => (item.key === key ? { ...item, percent } : item))),
      );
      if (!sent) {
        await removeResponseDocument(slug, documentId).catch(() => null);
        setProblem(`${file.name}: the file could not be sent. Try again.`);
        return false;
      }
      setDocuments((list) => [
        ...list,
        { id: documentId, responseId: null, fileName: file.name, sizeBytes: file.size, scanStatus: "pending", createdAt: new Date().toISOString() },
      ]);
      setRounds(0);
      setAnnouncement(`${file.name} was sent and is being checked.`);
      return true;
    } catch {
      setProblem(`${file.name}: the file could not be sent. Try again.`);
      return false;
    } finally {
      setUploads((list) => list.filter((item) => item.key !== key));
    }
  }

  async function choose(files: FileList | null) {
    setProblem("");
    if (!files) return;
    let attached = counted;
    for (const file of Array.from(files)) {
      if (await upload(file, attached)) attached += 1;
    }
    if (input.current) input.current.value = "";
  }

  async function remove(document: ResponseDocument) {
    setRemoving(document.id);
    const result = await removeResponseDocument(slug, document.id).catch(() => ({ message: "The document was not removed. Try again." }));
    setRemoving(null);
    if (result.message) {
      toastError("The document was not removed", result.message);
      return;
    }
    setDocuments((list) => list.filter((item) => item.id !== document.id));
    setAnnouncement(`${document.fileName} was removed.`);
  }

  const inputId = `${id}-file`;
  const descriptionId = `${id}-description`;
  const problemId = `${id}-problem`;
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1.5 text-body font-medium">Supporting documents (optional)</legend>
      <p id={descriptionId} className="text-small leading-normal text-muted-foreground">
        {documentsLimitText(max)}: PDF files of up to 15 MB each. Only the employer&apos;s members and your company can open them.
      </p>
      {documents.length > 0 || uploads.length > 0 ? (
        <ul className="grid gap-2" aria-label="Attached documents">
          {documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border bg-card p-3">
              <span className="flex min-w-0 items-center gap-2">
                <FileText aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-words">
                  {document.fileName} <span className="text-small text-muted-foreground">({formatFileSize(document.sizeBytes)})</span>
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge status={scanTones[document.scanStatus]}>{scanLabels[document.scanStatus]}</StatusBadge>
                <FormButton
                  type="button"
                  variant="secondary"
                  className="w-auto"
                  busy={removing === document.id}
                  onClick={() => remove(document)}
                >
                  Remove<span className="sr-only"> {document.fileName}</span>
                </FormButton>
              </span>
            </li>
          ))}
          {uploads.map((item) => (
            <li key={item.key} className="grid gap-2 rounded-xl border bg-card p-3">
              <span className="break-words">{item.name}</span>
              <progress className="h-2 w-full accent-primary" max={100} value={item.percent} aria-label={`Sending ${item.name}`}>
                {item.percent}%
              </progress>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={inputId} className="text-small font-medium">
        Add PDF files
      </label>
      <Input
        ref={input}
        id={inputId}
        type="file"
        multiple
        accept=".pdf,application/pdf"
        aria-describedby={problem ? `${descriptionId} ${problemId}` : descriptionId}
        aria-invalid={problem ? true : undefined}
        disabled={uploads.length > 0}
        className={cn("h-auto py-2.5", controlClassName)}
        onChange={(event) => void choose(event.target.files)}
      />
      <p id={problemId} role="alert" className="min-h-0 text-small text-destructive empty:hidden">
        {problem}
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </fieldset>
  );
}
