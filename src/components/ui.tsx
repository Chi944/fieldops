"use client";
import { SourcePreview } from "./source-preview";
import { useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  AlertCircle,
  Check,
  FileText,
  ScanLine,
  Table2,
  Minus,
  ArrowUpRight,
} from "lucide-react";
import type { FieldValue, Quotation, SourceSpan } from "@/lib/domain/types";
import { valueOf } from "@/lib/domain/types";
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      FieldOps<span className="brand-dot">.</span>
    </span>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "teal" | "amber" | "red" | "blue";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function FieldDisplay({
  field,
  onClick,
}: {
  field: FieldValue;
  onClick?: () => void;
}) {
  const content =
    field.state === "value"
      ? field.value
      : field.state === "not_stated"
        ? "Not stated"
        : field.state === "not_applicable"
          ? "Not applicable"
          : (field.raw ?? "Needs review");
  return (
    <button
      type="button"
      className={`field-value ${field.state !== "value" ? "missing" : ""} ${field.origin === "user" ? "corrected" : ""}`}
      onClick={onClick}
    >
      {content}
      {field.origin === "user" && (
        <Check size={12} aria-label="User corrected" />
      )}
      {field.state === "ambiguous" && <AlertCircle size={13} />}
    </button>
  );
}
export function FileIcon({
  format,
  size = 20,
}: {
  format: string;
  size?: number;
}) {
  return ["xlsx", "csv"].includes(format) ? (
    <Table2 size={size} />
  ) : ["png", "jpg", "jpeg"].includes(format) ? (
    <ScanLine size={size} />
  ) : (
    <FileText size={size} />
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) return;
    const remember = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && !target.closest('[role="dialog"]'))
        opener.current = target;
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, [open]);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          onOpenAutoFocus={() => {
            if (
              document.activeElement instanceof HTMLElement &&
              !document.activeElement.closest('[role="dialog"]')
            )
              opener.current = document.activeElement;
          }}
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
          className={`modal ${wide ? "wide" : ""}`}
          aria-describedby={description ? undefined : undefined}
        >
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={19} />
            </Dialog.Close>
          </div>
          <Dialog.Description
            className={description ? "modal-description" : "sr-only"}
          >
            {description ?? title}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
export function supplierName(q: Quotation) {
  return valueOf(q.supplier.name) ?? q.filename;
}
export function formatMoney(amount: string | null | undefined, currency = "") {
  if (amount == null) return "—";
  const parts = amount.split(".");
  const whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol =
    (
      { USD: "$", SGD: "S$", EUR: "€", GBP: "£", JPY: "¥" } as Record<
        string,
        string
      >
    )[currency] ?? `${currency} `;
  return `${symbol}${whole}${parts[1] ? `.${parts[1]}` : ""}`;
}
export function sourceLocation(s: SourceSpan) {
  return s.sheet
    ? `${s.sheet} · ${s.cell ?? "sheet"}`
    : s.page
      ? `Page ${s.page}`
      : `Text · characters ${s.start ?? 0}–${s.end ?? s.text.length}`;
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function openOriginal(q: Quotation) {
  if (q.isDemo && q.originalText)
    downloadBlob(
      new Blob([q.originalText], { type: "text/plain;charset=utf-8" }),
      q.filename,
    );
  else
    window.open(
      q.sourceUrl ?? `/api/documents/${q.documentId}/source`,
      "_blank",
      "noopener,noreferrer",
    );
}
export function SourceDocument({
  quotation,
  selectedSourceIds = [],
}: {
  quotation: Quotation;
  selectedSourceIds?: string[];
}) {
  const selected = quotation.sources.filter((s) =>
    selectedSourceIds.includes(s.id),
  );
  return (
    <div className="source-document">
      <div className="source-toolbar">
        <span>
          <FileIcon format={quotation.format} />
          {quotation.filename}
        </span>
        <button className="text-button" onClick={() => openOriginal(quotation)}>
          Original <ArrowUpRight size={14} />
        </button>
      </div>
      <SourcePreview quotation={quotation} selected={selected} />
      <div
        className="source-paper"
        tabIndex={0}
        role="region"
        aria-label="Quotation source excerpts"
      >
        <span className="evidence-label">Reflowed source excerpts</span>
        <div className="supplier-letterhead">
          <span className="supplier-monogram">
            {initials(supplierName(quotation))}
          </span>
          <div>
            <h3>{supplierName(quotation)}</h3>
            <p>
              {valueOf(quotation.supplier.email) ??
                "Original quotation evidence"}
            </p>
          </div>
        </div>
        <div className="source-title">
          <span>Quotation</span>
          <span>
            {valueOf(quotation.quotationNumber) ?? "Reference not stated"}
          </span>
        </div>
        <div className="source-meta">
          <span>{valueOf(quotation.date) ?? "Date not stated"}</span>
          <span>{valueOf(quotation.currency) ?? "Currency not stated"}</span>
        </div>
        {quotation.sources.length ? (
          <div className="source-lines">
            {quotation.sources.map((s) => (
              <div
                key={s.id}
                className={`source-line ${selectedSourceIds.includes(s.id) ? "highlighted" : ""}`}
                id={`source-${s.id}`}
              >
                <small>{sourceLocation(s)}</small>
                <pre>{s.text}</pre>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-copy">
            No extracted source text is available. Open the original to inspect
            this document.
          </p>
        )}
      </div>
      {selected.length > 0 && (
        <div className="source-footnote">
          <Check size={14} />
          {selected.length} source{" "}
          {selected.length === 1 ? "reference" : "references"} highlighted.
          Locations come from the parser.
        </div>
      )}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">
        <Minus size={28} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
