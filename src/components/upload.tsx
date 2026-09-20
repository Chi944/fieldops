"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
  Trash2,
  X,
} from "lucide-react";
import type { Comparison, ProcessingRun, Quotation } from "@/lib/domain/types";
import { LIMITS } from "@/lib/domain/types";
import { demoComparisons } from "@/lib/demo";
import { proposeMatches } from "@/lib/domain/matching";
import { api, ApiRequestError, useWorkspace } from "./context";
import { Modal, FileIcon, openOriginal, supplierName } from "./ui";

interface Transfer {
  id: string;
  filename: string;
  progress: number;
  status: "uploading" | "done" | "failed" | "cancelled";
  message?: string;
  errorCode?: string;
  documentId?: string;
  file?: File;
}
const stageLabel: Record<string, string> = {
  queued: "Waiting to process",
  validating: "Checking file",
  parsing: "Reading source document",
  extracting: "Extracting quotation",
  reconciling: "Checking amounts and evidence",
  ready: "Ready for review",
  source_ready: "Source ready · enter and review items",
  partial: "Partial extraction — review required",
  failed: "Needs attention",
  cancelled: "Cancelled",
  waiting_quota: "Waiting for free processing allowance",
};
export function UploadScreen({ comparison }: { comparison: Comparison }) {
  const { capabilities, runs, refresh, save, toast, switchWorkspace } = useWorkspace();
  const [pasted, setPasted] = useState(""),
    [pasteName, setPasteName] = useState(""),
    [tab, setTab] = useState("files"),
    [transfers, setTransfers] = useState<Transfer[]>([]),
    [drag, setDrag] = useState(false),
    [pasting, setPasting] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    requests = useRef(new Map<string, XMLHttpRequest>());
  const [deleteQuote, setDeleteQuote] = useState<Quotation | null>(null),
    [supersedesId, setSupersedesId] = useState("");
  const available = !comparison.isDemo && capabilities.canUpload;
  const processingMode = capabilities.processingMode === "ai" && capabilities.canExtract ? "ai" : "parse_only";
  const update = (id: string, patch: Partial<Transfer>) =>
    setTransfers((all) =>
      all.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  const failTransfer = (id: string, error: unknown) => update(id, {
    status: "failed",
    message: error instanceof Error ? error.message : "The upload failed. Try again.",
    errorCode: error instanceof ApiRequestError ? error.code : undefined,
    documentId: error instanceof ApiRequestError ? error.details?.documentId : undefined,
  });
  const upload = async (file: File, allowDuplicate = false) => {
    if (!available) {
      toast(
        "Open your personal workspace to add your own quotations. Sample comparisons accept fictional examples only.",
        true,
      );
      return;
    }
    if (file.size > LIMITS.fileBytes) {
      toast(
        `${file.name} exceeds the 20 MB limit. Split or compress the document.`,
        true,
      );
      return;
    }
    const id = crypto.randomUUID();
    setTransfers((all) => [
      ...all,
      { id, filename: file.name, progress: 0, status: "uploading", file },
    ]);
    try {
      let target = `/api/comparisons/${comparison.id}/uploads`,
        method = "POST",
        body: FormData | File;
      let cloudDocumentId: string | undefined;
      let uploadHeaders: Record<string, string> = {};
      if (capabilities.mode === "cloud") {
        const hash = await crypto.subtle.digest(
          "SHA-256",
          await file.arrayBuffer(),
        );
        const sha256 = Array.from(new Uint8Array(hash), (x) =>
          x.toString(16).padStart(2, "0"),
        ).join("");
        const ticket = await api<{
          documentId: string;
          uploadUrl: string;
          contentType: string;
          method: "PUT";
          headers: Record<string, string>;
        }>(`/api/comparisons/${comparison.id}/uploads/initiate`, {
          method: "POST",
          body: JSON.stringify({
            filename: file.name,
            size: file.size,
            sha256,
            allowDuplicate,
            processingMode,
            ...(supersedesId ? { supersedesId } : {}),
          }),
        });
        cloudDocumentId = ticket.documentId;
        target = ticket.uploadUrl;
        method = ticket.method;
        uploadHeaders = ticket.headers;
        body = file;
      } else {
        body = new FormData();
        body.append("file", file);
        body.append("processingMode", processingMode);
        if (allowDuplicate) body.append("allowDuplicate", "true");
        if (supersedesId) body.append("supersedesId", supersedesId);
      }
      const xhr = new XMLHttpRequest();
      requests.current.set(id, xhr);
      xhr.open(method, target);
      for (const [header, value] of Object.entries(uploadHeaders))
        xhr.setRequestHeader(header, value);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable)
          update(id, { progress: Math.round((e.loaded / e.total) * 100) });
      };
      xhr.onload = async () => {
        requests.current.delete(id);
        try {
          if (xhr.status < 200 || xhr.status >= 300) {
            let payload: unknown;
            try {
              payload = JSON.parse(xhr.responseText);
            } catch {}
            throw new ApiRequestError(xhr.status, payload, "The upload failed. Try again.");
          }
          if (cloudDocumentId)
            await api(`/api/documents/${cloudDocumentId}/finalize`, {
              method: "POST",
            });
          update(id, { status: "done", progress: 100 });
          await refresh(comparison.id);
        } catch (error) {
          failTransfer(id, error);
        }
      };
      xhr.onerror = () => {
        requests.current.delete(id);
        update(id, {
          status: "failed",
          message: "Connection interrupted. Your other files are safe.",
        });
      };
      xhr.onabort = () => {
        requests.current.delete(id);
        update(id, {
          status: "cancelled",
          message:
            "Upload cancelled. Remove its pending document before re-uploading.",
        });
        void refresh(comparison.id);
      };
      xhr.send(body);
    } catch (error) {
      failTransfer(id, error);
    }
  };
  const addSamples = async () => {
    const sample = demoComparisons()[0];
    const existing = new Set(comparison.quotations.map((q) => q.id));
    const quotations = [
      ...comparison.quotations,
      ...sample.quotations.filter((q) => !existing.has(q.id)),
    ].slice(0, LIMITS.files);
    try {
      await save({
        ...comparison,
        quotations,
        groups: proposeMatches(quotations),
      });
      toast(
        "Saved sample quotations added. These are demonstration extractions.",
      );
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const controlRun = async (run: ProcessingRun, action: "cancel" | "retry") => {
    try {
      await api(`/api/runs/${run.id}/${action}`, { method: "POST" });
      await refresh(comparison.id);
      toast(
        action === "cancel"
          ? "Cancellation requested."
          : "Retry queued. Completed work is preserved.",
      );
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <div className="upload-layout">
      <section>
        <div className="section-heading compact">
          <div>
            <h2>Add supplier quotations</h2>
            <p>
              Keep the originals. We’ll help you bring the details together.
            </p>
          </div>
        </div>
        {!comparison.isDemo && <>
        <div className="upload-method-note"><ShieldCheck size={17} /><div><strong>{processingMode === "parse_only" ? "Read sources, then enter reviewed items" : "Read sources and propose extracted items"}</strong><p>{processingMode === "parse_only" ? "Your file is saved and its readable pages or cells are prepared for review. No AI model is called; you enter and confirm the quotation details beside the source." : "The configured AI service proposes values from your source. Review every important field before comparing."}</p></div></div>
        <div className="segmented upload-tabs">
          <button
            className={tab === "files" ? "active" : ""}
            onClick={() => setTab("files")}
          >
            Upload files
          </button>
          <button
            className={tab === "text" ? "active" : ""}
            onClick={() => setTab("text")}
          >
            Paste quotation text
          </button>
        </div>
        {tab === "files" ? (
          <div
            className={`dropzone ${drag ? "dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              for (const file of Array.from(e.dataTransfer.files))
                void upload(file);
            }}
          >
            <span className="upload-symbol">
              <UploadCloud size={29} />
            </span>
            <h3>Bring your quotations together</h3>
            <p>Drop files here, or choose them from your device.</p>
            <input
              ref={input}
              className="sr-only"
              type="file"
              multiple
              disabled={!available}
              accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.txt"
              aria-label="Choose quotation files"
              onChange={(e) => {
                for (const file of Array.from(e.target.files ?? []))
                  void upload(file);
                e.target.value = "";
              }}
            />
            <button
              className="button primary"
              onClick={() => input.current?.click()}
              disabled={!available}
            >
              <Plus size={16} />
              Choose files
            </button>
            <small>PDF, PNG, JPEG, XLSX, CSV or TXT · up to 20 MB each</small>
          </div>
        ) : (
          <form
            className="paste-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!available) {
                toast(
                  "Configure a local or private workspace to process new quotation text.",
                  true,
                );
                return;
              }
              setPasting(true);
              try {
                await api(`/api/comparisons/${comparison.id}/uploads`, {
                  method: "POST",
                  body: JSON.stringify({
                    text: pasted,
                    filename: pasteName.trim()
                      ? `${pasteName.trim()}.txt`
                      : "quotation.txt",
                    processingMode,
                    ...(supersedesId ? { supersedesId } : {}),
                  }),
                });
                setPasted("");
                await refresh(comparison.id);
                toast("Quotation saved and queued for processing.");
              } catch (error) {
                toast((error as Error).message, true);
              } finally {
                setPasting(false);
              }
            }}
          >
            <label className="form-label">
              Supplier or document name
              <input
                placeholder="e.g. Acme quotation"
                value={pasteName}
                onChange={(e) => setPasteName(e.target.value)}
              />
            </label>
            <label className="form-label">
              Quotation text
              <textarea
                placeholder="Paste the complete quotation, including line items, prices and commercial terms…"
                rows={11}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                maxLength={LIMITS.textChars}
                required
              />
            </label>
            <div className="paste-footer">
              <span>{pasted.length.toLocaleString()} / 100,000 characters</span>
              <button
                className="button primary"
                disabled={!available || !pasted.trim() || pasting}
              >
                {pasting ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <ArrowRight size={16} />
                )}
                Process quotation
              </button>
            </div>
          </form>
        )}
        {!comparison.isDemo && comparison.quotations.length > 0 && (
          <label className="form-label revision-selector">
            Quotation revision
            <select
              value={supersedesId}
              onChange={(e) => setSupersedesId(e.target.value)}
            >
              <option value="">New independent quotation</option>
              {comparison.quotations.map((q) => (
                <option key={q.id} value={q.documentId}>
                  Revises {q.filename}
                </option>
              ))}
            </select>
            <small>
              Upload one revised quotation at a time. Earlier supplier values
              remain separate.
            </small>
          </label>
        )}
        </>}
        {comparison.isDemo ? (
          <div className="sample-callout">
            <FileText size={24} />
            <div>
              <strong>Use fictional quotations in this sample comparison</strong>
              <p>
                Add the three studio suppliers to explore this workflow. Their saved interpretations are examples, and your edits stay in this browser.
              </p>
            </div>
            <button className="button secondary" onClick={addSamples}>
              Add samples
            </button>
          </div>
        ) : (
          !capabilities.canUpload && (
            <div className="notice-box">
              <AlertCircle size={18} />
              <div>
                <strong>Personal uploads are not available yet</strong>
                <p>{capabilities.reasons.join(" ") || "Check your personal workspace connection, then retry."}</p>
              </div>
            </div>
          )
        )}
        {comparison.isDemo && <div className="sample-own-workspace"><p>Comparing your own suppliers?</p><button className="text-button" onClick={() => switchWorkspace("personal")}>Go to my personal workspace<ArrowRight size={15} /></button></div>}
        <div className="section-heading compact files-heading">
          <h2>
            Quotations{" "}
            <span className="subtle-count">{comparison.quotations.length}</span>
          </h2>
          <span className="small muted">Up to 5 suppliers per comparison</span>
        </div>
        <div className="file-list">
          {comparison.quotations.map((q) => {
            const run = [...runs]
              .reverse()
              .find((r) => r.documentId === q.documentId);
            const active =
              run &&
              [
                "queued",
                "validating",
                "parsing",
                "extracting",
                "reconciling",
              ].includes(run.stage);
            return (
              <div className="file-row" key={q.id}>
                <span className={`file-type ${q.format}`}>
                  <FileIcon format={q.format} />
                  <small>{q.format.toUpperCase()}</small>
                </span>
                <div className="file-details">
                  <strong>{supplierName(q)}</strong>
                  <button
                    className="text-button file-name"
                    onClick={() => openOriginal(q)}
                  >
                    {q.filename}
                    <ArrowRight size={11} />
                  </button>
                  <div className="file-status">
                    {active ? (
                      <Loader2 size={12} className="spin" />
                    ) : ["ready", "partial", "source_ready"].includes(q.status) ? (
                      <Check size={12} />
                    ) : (
                      <AlertCircle size={12} />
                    )}
                    <span>
                      {stageLabel[active ? run.stage : q.status] ?? q.status}
                      {q.isDemo ? " · saved sample" : ""}
                    </span>
                    {q.items.length > 0 && (
                      <span>· {q.items.length} items</span>
                    )}
                  </div>
                  {run?.message && !active && (
                    <p className="small muted">
                      {run.errorCode === "ai_unavailable"
                        ? "Source preserved. Add reviewed items manually, or retry when automatic extraction is available."
                        : run.message}
                    </p>
                  )}
                  {active && (
                    <div className="progress-track">
                      <span style={{ width: `${run.progress}%` }} />
                    </div>
                  )}
                </div>
                <div className="file-actions">
                  {q.sources.length > 0 && !active && (
                    <Link
                      className="button small secondary"
                      href={`/comparisons/${comparison.id}/review?q=${q.id}`}
                    >
                      {q.items.length ? "Resume review" : "Enter quotation details"}
                    </Link>
                  )}
                  <button
                    className="icon-button"
                    aria-label={`Delete ${q.filename}`}
                    onClick={() => setDeleteQuote(q)}
                  >
                    <Trash2 size={15} />
                  </button>
                  {active ? (
                    <button
                      className="button small secondary"
                      onClick={() => controlRun(run, "cancel")}
                    >
                      Cancel
                    </button>
                  ) : run &&
                    ["failed", "cancelled", "waiting_quota"].includes(
                      run.stage,
                    ) ? (
                    <button
                      className="button small secondary"
                      onClick={() => controlRun(run, "retry")}
                    >
                      <RotateCcw size={13} />
                      Retry
                    </button>
                  ) : (
                    <Link
                      href={`/comparisons/${comparison.id}/review?q=${q.id}`}
                      className="icon-button"
                      aria-label={`Review ${supplierName(q)}`}
                    >
                      <ChevronRight size={20} />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
          {transfers
            .filter((t) => t.status !== "done")
            .map((t) => (
              <div className="file-row" key={t.id}>
                <span className="file-type">
                  <FileText size={20} />
                </span>
                <div className="file-details">
                  <strong>{t.filename}</strong>
                  <p
                    className={
                      t.status === "failed" ? "error-text small" : "small muted"
                    }
                  >
                    {t.status === "uploading"
                      ? `Uploading ${t.progress}%`
                      : t.message}
                  </p>
                  {t.status === "uploading" && (
                    <div className="progress-track">
                      <span style={{ width: `${t.progress}%` }} />
                    </div>
                  )}
                </div>
                {t.status === "uploading" ? (
                  <button
                    className="icon-button"
                    aria-label={`Cancel ${t.filename}`}
                    onClick={() => requests.current.get(t.id)?.abort()}
                  >
                    <X size={17} />
                  </button>
                ) : (
                  t.status === "failed" &&
                  t.file && (
                    <div className="file-actions">
                    {t.errorCode === "duplicate" && t.documentId && (
                      <a
                        className="button small secondary"
                        href={`/api/documents/${encodeURIComponent(t.documentId)}/source`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open existing source
                      </a>
                    )}
                    <button
                      className="button small secondary"
                      onClick={() => {
                        setTransfers((all) => all.filter((x) => x.id !== t.id));
                        void upload(
                          t.file!,
                          t.errorCode === "duplicate",
                        );
                      }}
                    >
                      {t.errorCode === "duplicate" ? "Upload separate copy" : "Retry"}
                    </button>
                    </div>
                  )
                )}
              </div>
            ))}
        </div>
        {comparison.quotations.length > 0 && (
          <div className="section-bottom">
            <p>
              <ShieldCheck size={15} />
              Successful files are preserved if another file fails.
            </p>
            <Link
              href={`/comparisons/${comparison.id}/review`}
              className="button primary"
            >
              {processingMode === "parse_only" && !comparison.isDemo ? "Review sources and items" : "Review extractions"}
              <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </section>
      <aside className="context-panel">
        <span className="context-icon">
          <ShieldCheck size={22} />
        </span>
        <h3>The detail matters.</h3>
        <p>
          Upload each supplier’s complete quotation, including the pages with
          terms and conditions.
        </p>
        <div className="context-divider" />
        <h4>What works well</h4>
        <ul className="check-list">
          <li>
            <Check size={14} />
            Text PDFs and legible printed scans
          </li>
          <li>
            <Check size={14} />
            Spreadsheets with line items
          </li>
          <li>
            <Check size={14} />
            Goods, services, or a mix of both
          </li>
        </ul>
        <h4>Keep in mind</h4>
        <p className="small">
          Up to 10 PDF pages or 5 worksheets. Password-protected documents need
          an unlocked copy. Unclear values are flagged for review.
        </p>
        <div className="context-divider" />
        <p className="small">
          Originals remain private in a configured workspace. Samples in this
          demo are fictional.
        </p>
        {!comparison.isDemo && processingMode === "ai" && <p className="small">Automatic extraction sends parsed quotation text and source references to Groq. Review the extracted values before comparing. Free processing quotas can interrupt a job; successful work is preserved.</p>}
      </aside>
      <Modal
        open={!!deleteQuote}
        onClose={() => setDeleteQuote(null)}
        title="Delete this quotation?"
        description="The original file and its extracted data will be removed. Affected matches will need review again."
      >
        <div className="modal-actions">
          <button
            className="button secondary"
            onClick={() => setDeleteQuote(null)}
          >
            Keep quotation
          </button>
          <button
            className="button danger"
            onClick={async () => {
              if (!deleteQuote) return;
              try {
                if (comparison.isDemo) {
                  const next = structuredClone(comparison);
                  next.quotations = next.quotations.filter(
                    (q) => q.id !== deleteQuote.id,
                  );
                  next.corrections = next.corrections.filter(
                    (c) => c.quotationId !== deleteQuote.id,
                  );
                  next.groups = next.groups
                    .map((g) => ({
                      ...g,
                      members: g.members.filter(
                        (m) => m.quotationId !== deleteQuote.id,
                      ),
                      status: "stale" as const,
                      approvedRevision: null,
                    }))
                    .filter((g) => g.members.length);
                  await save(next);
                } else {
                  await api(`/api/documents/${deleteQuote.documentId}`, {
                    method: "DELETE",
                    body: JSON.stringify({ baseRevision: comparison.revision }),
                  });
                  await refresh(comparison.id);
                }
                setDeleteQuote(null);
                toast("Quotation deleted. Affected matches require review.");
              } catch (error) {
                toast((error as Error).message, true);
              }
            }}
          >
            Delete quotation
          </button>
        </div>
      </Modal>
    </div>
  );
}
