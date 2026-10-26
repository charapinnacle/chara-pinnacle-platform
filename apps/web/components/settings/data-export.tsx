"use client";

import { FileArchive } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { StatusBadge } from "@/components/feedback/status-badge";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import { Card } from "@/components/layout/card";
import { downloadDataExport, requestDataExport } from "@/lib/actions/data-export";
import type { DataExport, DataExports } from "@/lib/dal/data-export";
import { exportStateLabels, exportStateTones, formatSize, notIncludedText } from "@/lib/data-export/presentation";
import { formatDate, formatDateTime } from "@/lib/i18n/format";

// While an export is being prepared the page reads the state again, so the download appears without a reload; after a
// quarter of an hour it stops and leaves it to the email.
const REFRESH_MS = 5_000;
const REFRESH_LIMIT_MS = 15 * 60_000;
const READY = "Your data is ready to download.";

export function DataExportPanel({ exports, nextRequestAt }: DataExports) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [seen, setSeen] = useState(exports);
  const [announcement, setAnnouncement] = useState("");
  const request = useActionCall("Could not request your data");
  const preparing = exports.some((item) => item.state === "preparing");

  // An export that was being prepared and is now ready is announced to screen readers.
  if (seen !== exports) {
    const waiting = new Set(seen.filter((item) => item.state === "preparing").map((item) => item.id));
    if (exports.some((item) => item.state === "ready" && waiting.has(item.id))) setAnnouncement(READY);
    setSeen(exports);
  }

  useEffect(() => {
    if (!preparing) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > REFRESH_LIMIT_MS) {
        window.clearInterval(timer);
        setStopped(true);
        return;
      }
      router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [preparing, router]);

  function close() {
    setOpen(false);
  }

  return (
    <div className="grid gap-6">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="grid gap-3">
        {preparing && stopped ? (
          <Notice tone="info" role="status">
            Preparing your data is taking a while. We will email you when it is ready.
          </Notice>
        ) : null}
        {nextRequestAt && !preparing ? (
          <Notice tone="info" role="status">
            You can ask for a new export from {formatDateTime(nextRequestAt)}.
          </Notice>
        ) : null}
        <FormButton type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
          Download my data
        </FormButton>
      </div>
      <ModalDialog open={open} onClose={close} title="Prepare a copy of your data?">
        <p className="text-body leading-relaxed">
          We put your data into one file. This can take a few minutes. We send you an email when it is ready, and you can then download it
          here for a few days.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" className="w-full" onClick={close}>
            Cancel
          </FormButton>
          <FormButton
            type="button"
            busy={request.pending}
            onClick={() =>
              request.run(requestDataExport, "We are preparing your data", () => {
                close();
                router.refresh();
              })
            }
          >
            Prepare my data
          </FormButton>
        </div>
      </ModalDialog>
      <div className="grid gap-3">
        <h2 className="text-h3">Your exports</h2>
        {exports.length === 0 ? (
          <EmptyState icon={FileArchive} flat title="No exports yet" description="A copy you ask for appears here when it is ready." />
        ) : (
          <ul className="grid gap-3">
            {exports.map((item) => (
              <ExportRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ExportRow({ item }: { item: DataExport }) {
  const download = useActionCall("Could not download your data");
  return (
    <Card as="li" className="gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="grid gap-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge status={exportStateTones[item.state]}>{exportStateLabels[item.state]}</StatusBadge>
          <span className="text-small text-muted-foreground">Requested on {formatDate(item.requestedAt)}</span>
        </p>
        {item.state === "ready" && item.expiresAt ? (
          <p className="text-small text-muted-foreground">
            Available until {formatDateTime(item.expiresAt)}
            {item.sizeBytes ? ` · ${formatSize(item.sizeBytes)}` : ""}
            {item.filesLeftOut > 0 ? ` · ${notIncludedText(item.filesLeftOut)}` : ""}
          </p>
        ) : item.state === "failed" ? (
          <p className="text-small text-muted-foreground">Something went wrong while preparing this copy. Ask for a new one.</p>
        ) : item.state === "preparing" ? (
          <p className="text-small text-muted-foreground">We will email you when it is ready.</p>
        ) : null}
      </div>
      {item.state === "ready" ? (
        <FormButton
          type="button"
          variant="secondary"
          className="w-full sm:w-auto"
          busy={download.pending}
          onClick={() =>
            download.run(async () => {
              const result = await downloadDataExport(item.id);
              if (result.url) window.location.assign(result.url);
              return result;
            }, "Your download is starting")
          }
        >
          Download<span className="sr-only"> the export of {formatDate(item.requestedAt)}</span>
        </FormButton>
      ) : null}
    </Card>
  );
}
