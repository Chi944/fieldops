"use client";
import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import type { WorkspaceStatus } from "@/lib/domain/workspace-status";
import { api } from "./context";
import { Badge, Modal } from "./ui";

const mib = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;

function CapacityRow({ name, value, limit, bytes = false }: { name: string; value: number; limit: number; bytes?: boolean }) {
  const label = `${bytes ? mib(value) : value} of ${bytes ? mib(limit) : limit}`;
  return <div className="capacity-row"><div><span>{name}</span><strong>{label}</strong></div>
    <meter min={0} max={limit} value={Math.min(value, limit)} aria-label={`${name}: ${label}`} />
  </div>;
}

export function WorkspaceStatusDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [result, setResult] = useState<WorkspaceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setLoading(true); setError(null); setResult(null);
      return api<WorkspaceStatus>("/api/workspace/status", { signal: controller.signal })
        .then(value => { if (!controller.signal.aborted) setResult(value); })
        .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Workspace status is unavailable."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    });
    return () => controller.abort();
  }, [open, refresh]);
  return <Modal open={open} onClose={onClose} title="Workspace status" description="Your usage, processing availability and pending cleanup. Updated only when you open or refresh this panel.">
    <div className="workspace-status-body" aria-busy={loading}>
      {loading && <p role="status"><Loader2 size={16} className="spin" /> Checking your workspace…</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {result && <>
        <div className="status-labels"><Badge tone={result.uploadsAvailable ? "teal" : "amber"}>{result.uploadsAvailable ? "Uploads configured" : "Uploads unavailable"}</Badge><Badge tone={result.processing === "ai" ? "blue" : "neutral"}>{result.processing === "ai" ? "AI assistance enabled" : "Manual source review"}</Badge></div>
        <p>{result.processing === "ai" ? "Automatic interpretation produces suggestions. Review evidence and approve matches before using a recommendation." : "Uploads prepare readable sources. Enter and review quotation values yourself; automatic AI extraction is off."}</p>
        {result.capacity ? <section aria-label="Workspace capacity">
          <h3>Your private storage</h3>
          <CapacityRow name="Comparisons" value={result.capacity.comparisons} limit={result.capacity.limits.comparisons} />
          <CapacityRow name="Original files" value={result.capacity.documents} limit={result.capacity.limits.documents} />
          <CapacityRow name="Reserved file storage" value={result.capacity.bytes} limit={result.capacity.limits.bytes} bytes />
          <p className="status-note">Pending uploads and deletion cleanup still reserve storage. Incomplete uploads expire after {result.uploadIntentTtlHours} hours.</p>
          {result.capacity.pendingDeletionDocuments > 0 && <p role="status">{result.capacity.pendingDeletionDocuments} deleted files ({mib(result.capacity.pendingDeletionBytes)}) await final cleanup. They are no longer accessible in FieldOps. Capacity returns after cleanup succeeds.</p>}
          {result.sharedCapacityAvailable === false && <p className="inline-error">The shared pilot capacity is full. New uploads may be paused even if your workspace has space. Existing work remains available.</p>}
        </section> : <p className="status-note">Local files stay on this computer. Available disk space limits storage. Use the documented personal backup and restore commands to protect your work.</p>}
        <section aria-label="Processing queue"><h3>Processing queue</h3><dl className="status-job-counts"><div><dt>In progress</dt><dd>{result.jobs.active}</dd></div><div><dt>Waiting for quota</dt><dd>{result.jobs.waitingQuota}</dd></div><div><dt>Failed</dt><dd>{result.jobs.failed}</dd></div></dl></section>
        {result.jobs.failed > 0 && <p>Open the affected comparison’s Quotations step for the failure reason and available recovery options.</p>}
        <p className="status-note">These are application limits, not a guarantee of provider availability. Free allowances can pause processing; there is no paid fallback.</p>
        <p className="status-note">Checked {new Date(result.checkedAt).toLocaleString()}. Configured services have not been tested by this check.</p>
      </>}
    </div>
    <div className="modal-actions"><button className="button secondary" onClick={() => setRefresh(value => value + 1)} disabled={loading}><RotateCcw size={15} /> Refresh status</button><button className="button primary" onClick={onClose}>Done</button></div>
  </Modal>;
}
