"use client";
import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ClipboardCheck,
  History,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  Comparison,
  emptyItem,
  FieldState,
  FieldValue,
  ReviewIssue,
  field,
} from "@/lib/domain/types";
import { resolveCorrectableField } from "@/lib/domain/corrections";
import { proposeMatches } from "@/lib/domain/matching";
import { api, lastCorrection, useWorkspace } from "./context";
import {
  Badge,
  EmptyState,
  FieldDisplay,
  Modal,
  SourceDocument,
  supplierName,
} from "./ui";

export function ReviewScreen({
  comparison,
  initialQuotationId,
}: {
  comparison: Comparison;
  initialQuotationId?: string;
}) {
  const { correct, save, refresh, toast } = useWorkspace();
  const initialQuotation = comparison.quotations.find(q => q.id === initialQuotationId)
    ?? comparison.quotations.find(q => q.issues.some(issue => !issue.resolved))
    ?? comparison.quotations[0];
  const [quotationId, setQuotationId] = useState(
    initialQuotation?.id ?? "",
  );
  const quotation =
    comparison.quotations.find((q) => q.id === quotationId) ??
    initialQuotation;
  const [selectedSources, setSelectedSources] = useState<string[]>([]),
    [selectedPath, setSelectedPath] = useState(""),
    [selectedLabel, setSelectedLabel] = useState(""),
    [selectedIssueId, setSelectedIssueId] = useState("");
  const [editing, setEditing] = useState<{
      path: string;
      label: string;
      value: FieldValue;
    } | null>(null),
    [editValue, setEditValue] = useState(""),
    [editState, setEditState] = useState<FieldState>("value"),
    [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false),
    [history, setHistory] = useState(false),
    [addRow, setAddRow] = useState(false),
    [onlyIssues, setOnlyIssues] = useState(false);
  const [acknowledge, setAcknowledge] = useState<string | null>(null),
    [resolution, setResolution] = useState("");
  const [manualSourceIds, setManualSourceIds] = useState<string[]>([]);
  const [manual, setManual] = useState({
    description: "",
    quantity: "1",
    unit: "each",
    unitPrice: "",
    currency: "USD",
    kind: "goods",
    billingBasis: "",
    scope: "",
    taxBasis: "not_stated",
    taxRate: "",
    reason: "Recovered from original quotation during manual review",
  });
  if (!quotation)
    return (
      <EmptyState
        title="Add a quotation to begin review"
        description="Your supplier’s original document will appear beside its extracted values."
        action={
          <Link
            className="button primary"
            href={`/comparisons/${comparison.id}/upload`}
          >
            Add quotations
            <ArrowRight size={16} />
          </Link>
        }
      />
    );
  const issues = quotation.issues.filter((i) => !i.resolved).sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error"));
  const recordedReviews = quotation.issues.filter((issue) => issue.resolved).length;
  const manualReviewIssue = quotation.issues.find(issue => issue.id === `${quotation.id}:manual-review` && !issue.resolved);
  const confirmingManualReview = acknowledge === `${quotation.id}:manual-review`;
  const nextIssue = issues.length ? issues[(issues.findIndex(issue => issue.id === selectedIssueId) + 1) % issues.length] : undefined;
  const selectedEvidence = quotation.sources.filter(source => selectedSources.includes(source.id));
  const visiblePath = (path: string) => {
    const parts = path.split(".");
    if (/^\d+$/.test(parts[1] ?? "")) {
      const record = parts[0] === "items" ? quotation.items[Number(parts[1])] : parts[0] === "charges" ? quotation.charges[Number(parts[1])] : undefined;
      if (record) parts[1] = record.id;
    }
    return parts.join(".");
  };
  const fieldId = (path: string) => `review-field-${quotation.id}-${path}`;
  const scrollOptions = (): ScrollIntoViewOptions => ({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  const select = (path: string, value: FieldValue, label?: string) => {
    setSelectedPath(path);
    setSelectedLabel(label ?? path.split(".").at(-1)!.replace(/([a-z])([A-Z])/g, "$1 $2"));
    const sourceIds = value.sourceIds.filter(id => quotation.sources.some(source => source.id === id));
    setSelectedSources(sourceIds);
    const source = sourceIds[0];
    if (source)
      setTimeout(
        () =>
          document
            .getElementById(`source-${source}`)
            ?.scrollIntoView(scrollOptions()),
        30,
      );
  };
  const inspectIssue = (issue: ReviewIssue) => {
    let supportingIds = issue.sourceIds;
    if (!supportingIds.length && issue.fieldPath) {
      try { supportingIds = resolveCorrectableField(quotation, issue.fieldPath).sourceIds; } catch { /* Coverage issues may not identify an editable field. */ }
    }
    const validIds = supportingIds.filter(id => quotation.sources.some(source => source.id === id));
    setSelectedIssueId(issue.id);
    const path = issue.fieldPath ? visiblePath(issue.fieldPath) : "";
    setSelectedPath(path);
    setSelectedLabel(issue.message);
    setSelectedSources(validIds);
    setOnlyIssues(false);
    setTimeout(() => {
      const target = (path ? document.getElementById(fieldId(path)) : null) ?? (issue.itemId ? document.getElementById(`review-item-${quotation.id}-${issue.itemId}`) : null);
      for (let parent = target?.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
      target?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      target?.scrollIntoView(scrollOptions());
      // In the stacked layout, scrolling to evidence would hide the focused field.
      if (validIds[0] && (!target || window.matchMedia("(min-width: 901px)").matches)) document.getElementById(`source-${validIds[0]}`)?.scrollIntoView(scrollOptions());
    }, 30);
  };
  const edit = (path: string, label: string, value: FieldValue) => {
    select(path, value, label);
    setEditing({ path, label, value });
    setEditValue(value.value ?? "");
    setEditState(value.state);
    setReason("");
  };
  const renderField = (path: string, label: string, value: FieldValue) => (
    <div
      className={`review-field ${selectedPath === path ? "selected" : ""}`}
      key={path}
      id={fieldId(path)}
    >
      <label>{label}</label>
      <div>
        <FieldDisplay field={value} onClick={() => select(path, value, label)} />
        <button
          className="icon-button edit-field"
          aria-label={`Correct ${label}`}
          onClick={() => edit(path, label, value)}
        >
          <Pencil size={13} />
        </button>
      </div>
    </div>
  );
  const metadataOptions = editing?.path.endsWith(".taxBasis")
    ? ["not_stated", "exclusive", "inclusive"]
    : editing?.path.endsWith(".kind")
      ? ["goods", "service", "mixed", "unknown"]
      : null;
  const filteredItems = onlyIssues
    ? quotation.items.filter(
        (i) =>
          issues.some((issue) => issue.itemId === i.id) ||
          [i.unitPrice, i.quantity, i.unit, i.currency].some(
            (f) => f.state !== "value",
          ),
      )
    : quotation.items;
  return (
    <>
      <div className="review-toolbar">
        <div className="supplier-select">
          <label htmlFor="review-supplier">Reviewing</label>
          <select
            id="review-supplier"
            value={quotation.id}
            onChange={(e) => {
              setQuotationId(e.target.value);
              setSelectedSources([]);
              setSelectedPath("");
              setSelectedLabel("");
              setSelectedIssueId("");
            }}
          >
            {comparison.quotations.map((q) => (
              <option value={q.id} key={q.id}>
                {supplierName(q)}{q.issues.some(issue => !issue.resolved) ? ` — ${q.issues.filter(issue => !issue.resolved).length} open` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="review-toolbar-right">
          <span className="small muted">Select a value to see its source</span>
          <button
            className="button secondary small"
            onClick={() => setHistory(true)}
          >
            <History size={15} />
            Correction history
            <span>
              {
                comparison.corrections.filter(
                  (c) => c.quotationId === quotation.id,
                ).length
              }
            </span>
          </button>
        </div>
      </div>
      <section className={`review-queue ${issues.length ? "has-issues" : ""}`} aria-label="Quotation review progress">
        <div className="review-queue-copy">
          <strong>{issues.length ? `${issues.length} ${issues.length === 1 ? "issue needs" : "issues need"} a decision` : "No open issues flagged"}</strong>
          <p>{issues.length ? "Check the evidence, then correct the value or record what still needs clarification." : "Check the original for anything missing, then review how items match across suppliers."}</p>
          <span>{quotation.items.length} line {quotation.items.length === 1 ? "item" : "items"} in this quotation{recordedReviews ? ` · ${recordedReviews} issue ${recordedReviews === 1 ? "review" : "reviews"} recorded` : ""}</span>
        </div>
        {nextIssue ? <button className="button primary small" onClick={() => inspectIssue(nextIssue)}>Review next issue <ArrowRight size={15} /></button> : <Link className="button secondary small" href={`/comparisons/${comparison.id}/matching`}>Review item matches <ArrowRight size={15} /></Link>}
      </section>
      <div className="review-layout">
        <div className="review-data">
          <div className="review-section-header">
            <h2>Extracted details</h2>
            <Badge tone={issues.length ? "amber" : "teal"}>
              {issues.length
                ? `${issues.length} to review`
                : "No flagged issues"}
            </Badge>
          </div>
          {manualReviewIssue && quotation.manifest.complete && <div className="notice-box manual-review-notice"><ClipboardCheck size={18} /><div><strong>Source ready for your review</strong><p>The original has been read without AI extraction. Enter the supplier name and all quotation items, check every page or sheet and the commercial terms, then confirm your manual review.</p><button className="button secondary small" disabled={!quotation.items.length || quotation.supplier.name.state !== "value"} onClick={() => { setAcknowledge(manualReviewIssue.id); setResolution(""); }}>Confirm manual review</button></div></div>}
          {(!quotation.manifest.complete ||
            (!manualReviewIssue && (quotation.status === "partial" ||
            issues.some((i) => i.code === "incomplete_extraction")))) && (
            <div className="notice-box red">
              <AlertCircle size={18} />
              <div>
                <strong>Extraction is incomplete</strong>
                <p>
                  Review the original for omitted rows or terms. You can correct
                  fields or add missing items below.
                </p>
              </div>
            </div>
          )}
          {issues.length > 0 && (
            <div className="issues-list">
              {issues.map((issue) => (
                <div key={issue.id} className="review-issue-row">
                  <button
                    className={`review-issue ${issue.severity} ${selectedIssueId === issue.id ? "active-issue" : ""}`}
                    aria-pressed={selectedIssueId === issue.id}
                    onClick={() => inspectIssue(issue)}
                  >
                    <AlertCircle size={16} />
                    <span>{issue.message}</span>
                    <Search size={13} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Acknowledge issue: ${issue.message}`}
                    onClick={() => {
                      setAcknowledge(issue.id);
                      setResolution("");
                    }}
                  >
                    <Check size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="review-fields">
            {renderField(
              "supplier.name",
              "Supplier name",
              quotation.supplier.name,
            )}
            {renderField(
              "quotationNumber",
              "Quotation reference",
              quotation.quotationNumber,
            )}
            {renderField("date", "Quotation date", quotation.date)}
            {renderField("currency", "Original currency", quotation.currency)}
            {renderField("supplier.email", "Email", quotation.supplier.email)}
            {renderField(
              "supplier.contact",
              "Contact",
              quotation.supplier.contact,
            )}
            {renderField("supplier.phone", "Phone", quotation.supplier.phone)}
            {renderField(
              "supplier.address",
              "Address",
              quotation.supplier.address,
            )}
            {renderField("locale", "Formatting context", quotation.locale)}
            {renderField("revision", "Supplier revision", quotation.revision)}
            {renderField("statedSubtotal", "Supplier-stated subtotal", quotation.statedSubtotal)}
            {renderField(
              "statedTotal",
              "Supplier-stated total",
              quotation.statedTotal,
            )}
          </div>
          <div className="review-section-header">
            <h3>
              Line items <span>{quotation.items.length}</span>
            </h3>
            <div className="inline-actions">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={onlyIssues}
                  onChange={(e) => setOnlyIssues(e.target.checked)}
                />
                Needs review
              </label>
              <button className="text-button" onClick={() => setAddRow(true)}>
                <Plus size={14} />
                Add item
              </button>
            </div>
          </div>
          {filteredItems.length === 0 ? (
            <div className="small-empty">
              <p>
                {quotation.items.length
                  ? "No line items match this filter."
                  : quotation.extractionVersion === 0 && !quotation.isDemo
                    ? "No items entered yet. Read the original quotation, then add every item you want to compare. Confirm manual review after checking all source sections."
                    : "No line items extracted yet. Review the original and add a missing item, or retry extraction once processing is available."}
              </p>
              <button
                className="button secondary small"
                onClick={() => setAddRow(true)}
              >
                <Plus size={14} />
                Add an item
              </button>
            </div>
          ) : (
            <div className="review-items">
              {filteredItems.map((item, index) => (
                <div className="review-item" key={item.id} id={`review-item-${quotation.id}-${item.id}`}>
                  <div className="review-item-title" id={fieldId(`items.${item.id}.description`)}>
                    <span className="item-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <FieldDisplay
                      field={item.description}
                      onClick={() =>
                        select(`items.${item.id}.description`, item.description)
                      }
                    />
                    <button
                      className="icon-button"
                      aria-label={`Correct description for item ${index + 1}`}
                      onClick={() =>
                        edit(
                          `items.${item.id}.description`,
                          "Item description",
                          item.description,
                        )
                      }
                    >
                      <Pencil size={13} />
                    </button>
                    <Badge>{item.kind}</Badge>
                  </div>
                  <div className="item-fields-grid">
                    {renderField(
                      `items.${item.id}.taxBasis`,
                      "Tax basis",
                      lastCorrection(
                        comparison.corrections,
                        quotation.id,
                        `items.${item.id}.taxBasis`,
                      )?.after ?? {
                        ...field(item.taxBasis, item.sourceIds),
                        raw: null,
                      },
                    )}
                    {renderField(
                      `items.${item.id}.kind`,
                      "Item type",
                      lastCorrection(
                        comparison.corrections,
                        quotation.id,
                        `items.${item.id}.kind`,
                      )?.after ?? {
                        ...field(item.kind, item.sourceIds),
                        raw: null,
                      },
                    )}
                    {renderField(
                      `items.${item.id}.quantity`,
                      "Quantity",
                      item.quantity,
                    )}
                    {renderField(`items.${item.id}.unit`, "Unit", item.unit)}
                    {renderField(
                      `items.${item.id}.unitPrice`,
                      "Unit price",
                      item.unitPrice,
                    )}
                    {renderField(
                      `items.${item.id}.lineAmount`,
                      "Line amount",
                      item.lineAmount,
                    )}
                    {renderField(
                      `items.${item.id}.identifier`,
                      "Identifier",
                      item.identifier,
                    )}
                    {renderField(
                      `items.${item.id}.currency`,
                      "Currency",
                      item.currency,
                    )}
                  </div>
                  <details className="item-extra-fields">
                    <summary>Specifications, packaging & billing</summary>
                    <div className="item-fields-grid">
                      {renderField(
                        `items.${item.id}.packageSize`,
                        "Package contents",
                        item.packageSize,
                      )}
                      {renderField(
                        `items.${item.id}.packageUnit`,
                        "Contents unit",
                        item.packageUnit,
                      )}
                      {renderField(
                        `items.${item.id}.minimumOrder`,
                        "Minimum order",
                        item.minimumOrder,
                      )}
                      {renderField(
                        `items.${item.id}.orderIncrement`,
                        "Order increment",
                        item.orderIncrement,
                      )}
                      {renderField(
                        `items.${item.id}.leadTime`,
                        "Item lead time",
                        item.leadTime,
                      )}
                      {renderField(
                        `items.${item.id}.duration`,
                        "Duration",
                        item.duration,
                      )}
                      {item.kind === "service" && (
                        <>
                          {renderField(
                            `items.${item.id}.billingBasis`,
                            "Billing basis",
                            item.billingBasis,
                          )}
                          {renderField(
                            `items.${item.id}.scope`,
                            "Service scope",
                            item.scope,
                          )}
                        </>
                      )}
                    </div>
                    {item.attributes.map((a, attributeIndex) =>
                      renderField(
                        `items.${item.id}.attributes.${attributeIndex}.value`,
                        `${a.label}${a.unit ? ` (${a.unit})` : ""}`,
                        a.value,
                      ),
                    )}
                    {item.tiers.length > 0 && (
                      <p className="small">
                        Price tiers:{" "}
                        {item.tiers
                          .map(
                            (t) =>
                              `${t.min}–${t.max ?? "above"} ${t.unit}: ${t.unitPrice} (${t.basis})`,
                          )
                          .join("; ")}
                      </p>
                    )}
                  </details>
                </div>
              ))}
            </div>
          )}
          {quotation.charges.length > 0 && (
            <details className="terms-details">
              <summary>
                Shipping, taxes & other charges
                <ChevronDown size={16} />
              </summary>
              {quotation.charges.map((charge) => (
                <div key={charge.id} className="review-fields">
                  <strong>{charge.label}</strong>
                  <span className="small muted">
                    {charge.kind} · {charge.appliesTo}
                    {charge.billingPeriod ? ` · ${charge.billingPeriod}` : ""}
                  </span>
                  {renderField(
                    `charges.${charge.id}.amount`,
                    "Charge amount",
                    charge.amount,
                  )}
                  {renderField(
                    `charges.${charge.id}.currency`,
                    "Charge currency",
                    charge.currency,
                  )}
                </div>
              ))}
            </details>
          )}
          <details className="terms-details">
            <summary>
              Commercial terms
              <ChevronDown size={16} />
            </summary>
            <div className="review-fields">
              {Object.entries(quotation.terms).map(([key, value]) =>
                renderField(
                  `terms.${key}`,
                  key === "leadTime"
                    ? "Lead time"
                    : key.charAt(0).toUpperCase() + key.slice(1),
                  value,
                ),
              )}
            </div>
          </details>
          <div className="review-legend">
            <span>
              <i className="legend-dot supplier" />
              Supplier stated
            </span>
            <span>
              <i className="legend-dot corrected" />
              User corrected
            </span>
            <span>
              <i className="legend-dot attention" />
              Needs review
            </span>
          </div>
        </div>
        <aside className="review-source">
          <div className="review-evidence-context" role="status" aria-live="polite">
            <strong>{selectedLabel ? "Selected evidence" : "Original quotation"}</strong>
            <p>{selectedLabel || "Select a value or review issue to locate its supporting source."}</p>
            {selectedLabel && <small>{selectedEvidence.length ? `${selectedEvidence.length} preserved source ${selectedEvidence.length === 1 ? "reference" : "references"} highlighted below.` : "No source reference is attached. Inspect the original before making a correction."}</small>}
          </div>
          {selectedSources.length > 0 && (
            <button
              className="text-button clear-source"
              onClick={() => {
                setSelectedSources([]);
                setSelectedPath("");
                setSelectedLabel("");
                setSelectedIssueId("");
              }}
            >
              Clear source selection
            </button>
          )}
          <SourceDocument
            quotation={quotation}
            selectedSourceIds={selectedSources}
          />
          <div className="source-integrity">
            <ShieldCheck size={15} />
            <span>
              Original evidence is preserved. Source excerpts are reflowed for
              reading; open the original for its full layout.
            </span>
          </div>
        </aside>
      </div>
      <div className="section-bottom">
        <p>
          <ClipboardCheck size={15} />
          Corrections never erase the original interpretation.
        </p>
        <Link
          className="button primary"
          href={`/comparisons/${comparison.id}/matching`}
        >
          Review item matches
          <ArrowRight size={16} />
        </Link>
      </div>
      <Modal
        open={!!acknowledge}
        onClose={() => setAcknowledge(null)}
        title={confirmingManualReview ? "Confirm manual review" : "Record issue review"}
        description={confirmingManualReview ? "Confirm that you checked every original page or sheet, entered all relevant items and reviewed the commercial terms. This records your assessment; it does not invent missing prices or terms or claim AI extraction." : "Acknowledgement records your reasoning. It does not remove the discrepancy or make incomplete costs comparable."}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!acknowledge) return;
            try {
              if (comparison.isDemo) {
                const next = structuredClone(comparison);
                const issue = next.quotations
                  .find((q) => q.id === quotation.id)!
                  .issues.find((i) => i.id === acknowledge)!;
                issue.resolved = true;
                issue.resolution = resolution;
                await save(next);
              } else {
                await api(`/api/comparisons/${comparison.id}/issues`, {
                  method: "POST",
                  body: JSON.stringify({
                    baseRevision: comparison.revision,
                    quotationId: quotation.id,
                    issueId: acknowledge,
                    reason: resolution,
                  }),
                });
                await refresh(comparison.id);
              }
              setAcknowledge(null);
              toast(
                "Review reasoning recorded. Original discrepancy remains available in the report.",
              );
            } catch (error) {
              toast((error as Error).message, true);
            }
          }}
        >
          <label className="form-label">
            Review reason
            <textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              required
              rows={3}
            />
          </label>
          <div className="modal-actions">
            <button className="button primary" disabled={!resolution.trim()}>
              {confirmingManualReview ? "Confirm manual review" : "Record review"}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Correct ${editing?.label.toLowerCase() ?? "value"}`}
        description="Your change is recorded separately from the supplier’s original value."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!editing) return;
            setSaving(true);
            try {
              await correct(
                comparison,
                quotation.id,
                editing.path,
                {
                  ...editing.value,
                  value: editState === "value" ? editValue.trim() : null,
                  raw: editState === "value" ? editValue.trim() : null,
                  state: editState,
                  origin: "user",
                },
                reason,
              );
              setEditing(null);
            } catch (error) {
              toast((error as Error).message, true);
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="original-value">
            <small>Current interpretation</small>
            <strong>{editing?.value.raw ?? editing?.value.value ?? editing?.value.state.replaceAll("_", " ") ?? "Not stated"}</strong>
          </div>
          {editing && <div className="correction-source-note">
            <ShieldCheck size={16} />
            <p>{editing.value.sourceIds.some(id => quotation.sources.some(source => source.id === id)) ? "This correction keeps its source links. The previous interpretation and your reason remain in correction history." : "This value has no attached source reference. Check the original; your change will be recorded as user input."} Price and scope changes require match review again.</p>
          </div>}
          {editing && quotation.sources.some(source => editing.value.sourceIds.includes(source.id)) && <details className="correction-evidence">
            <summary>View supporting source</summary>
            {quotation.sources.filter(source => editing.value.sourceIds.includes(source.id)).map(source => <blockquote key={source.id}>
              <small>{source.sheet ? `${source.sheet}${source.cell ? `!${source.cell}` : ""}` : source.page ? `Page ${source.page}` : typeof source.start === "number" ? `Text from character ${source.start}` : "Text excerpt"}</small>
              <p>{source.text}</p>
            </blockquote>)}
          </details>}
          <label className="form-label">
            Value state
            <select
              disabled={!!metadataOptions}
              value={editState}
              onChange={(e) => setEditState(e.target.value as FieldState)}
            >
              <option value="value">Stated value</option>
              <option value="not_stated">Not stated</option>
              <option value="ambiguous">Ambiguous</option>
              <option value="not_applicable">Not applicable</option>
            </select>
          </label>
          {editState === "value" && (
            <label className="form-label">
              Corrected value
              {metadataOptions ? (
                <select
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                >
                  {metadataOptions.map((option) => (
                    <option value={option} key={option}>
                      {option.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  required
                  autoFocus
                />
              )}
            </label>
          )}
          <label className="form-label">
            Reason for correction
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. The original states 12 units per box"
              required
            />
          </label>
          <div className="modal-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={saving || !reason.trim()}
            >
              <Check size={16} />
              Save correction
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={history}
        onClose={() => setHistory(false)}
        title="Correction history"
        description="Original interpretations and reviewed changes remain available."
        wide
      >
        <div className="history-list">
          {comparison.corrections.filter((c) => c.quotationId === quotation.id)
            .length === 0 ? (
            <p className="muted">No corrections to this quotation yet.</p>
          ) : (
            [...comparison.corrections]
              .reverse()
              .filter((c) => c.quotationId === quotation.id)
              .map((c) => (
                <article key={c.id}>
                  <small>{c.path}</small>
                  <div>
                    <del>{c.before.value ?? "Not stated"}</del>
                    <ArrowRight size={14} />
                    <strong>
                      {c.after.value ?? c.after.state.replaceAll("_", " ")}
                    </strong>
                  </div>
                  <p>{c.reason}</p>
                  <small>
                    {c.author} · {new Date(c.createdAt).toLocaleString()}
                  </small>
                </article>
              ))
          )}
        </div>
      </Modal>
      <Modal
        open={addRow}
        onClose={() => setAddRow(false)}
        title="Add a missing item"
        description="Manually entered values are labelled as user corrections. No source location will be invented."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              if (comparison.isDemo) {
                const item = emptyItem(crypto.randomUUID());
                item.kind = manual.kind as "goods" | "service";
                item.taxBasis = manual.taxBasis as typeof item.taxBasis;
                if (manual.taxRate)
                  item.taxRate = {
                    ...field(manual.taxRate, manualSourceIds),
                    origin: "user",
                  };
                item.sourceIds = manualSourceIds.filter((id) =>
                  quotation.sources.some((s) => s.id === id),
                );
                for (const key of [
                  "description",
                  "quantity",
                  "unit",
                  "unitPrice",
                  "currency",
                  "billingBasis",
                  "scope",
                ] as const) {
                  if (manual[key])
                    item[key] = {
                      ...field(manual[key], item.sourceIds),
                      origin: "user",
                    };
                }
                const next = structuredClone(comparison);
                next.quotations
                  .find((q) => q.id === quotation.id)!
                  .items.push(item);
                next.groups = proposeMatches(next.quotations);
                next.corrections.push({
                  id: crypto.randomUUID(),
                  operation: "add_item",
                  quotationId: quotation.id,
                  path: `items.${item.id}.description`,
                  before: {
                    state: "not_stated",
                    value: null,
                    raw: null,
                    sourceIds: [],
                    origin: "supplier",
                  },
                  after: item.description,
                  author: "Demo reviewer",
                  createdAt: new Date().toISOString(),
                  reason: manual.reason,
                  baseVersion: comparison.revision,
                });
                await save(next);
              } else {
                await api(`/api/comparisons/${comparison.id}/items`, {
                  method: "POST",
                  body: JSON.stringify({
                    baseRevision: comparison.revision,
                    quotationId: quotation.id,
                    item: {
                      ...manual,
                      taxRate: manual.taxRate || undefined,
                      sourceIds: manualSourceIds.filter((id) =>
                        quotation.sources.some((s) => s.id === id),
                      ),
                    },
                    reason: manual.reason,
                  }),
                });
                await refresh(comparison.id);
              }
              setAddRow(false);
              toast(
                "User-entered item added. Review its matching and source evidence.",
              );
            } catch (error) {
              toast((error as Error).message, true);
            } finally {
              setSaving(false);
            }
          }}
        >
          <label className="form-label">
            Item description
            <input
              value={manual.description}
              onChange={(e) =>
                setManual({ ...manual, description: e.target.value })
              }
              required
            />
          </label>
          <div className="form-grid">
            {(
              [
                ["quantity", "Quantity"],
                ["unit", "Unit"],
                ["unitPrice", "Unit price"],
                ["currency", "Currency"],
              ] as const
            ).map(([key, label]) => (
              <label className="form-label" key={key}>
                {label}
                <input
                  value={manual[key]}
                  onChange={(e) =>
                    setManual({ ...manual, [key]: e.target.value })
                  }
                  required
                />
              </label>
            ))}
          </div>
          <label className="form-label">
            Item type
            <select
              value={manual.kind}
              onChange={(e) => setManual({ ...manual, kind: e.target.value })}
            >
              <option value="goods">Physical goods</option>
              <option value="service">Service</option>
            </select>
          </label>
          <div className="form-grid">
            <label className="form-label">
              Tax basis
              <select
                value={manual.taxBasis}
                onChange={(e) =>
                  setManual({ ...manual, taxBasis: e.target.value })
                }
              >
                <option value="not_stated">Not stated</option>
                <option value="exclusive">Tax exclusive</option>
                <option value="inclusive">Tax inclusive</option>
              </select>
            </label>
            <label className="form-label">
              Explicit tax rate (%)
              <input
                value={manual.taxRate}
                onChange={(e) =>
                  setManual({ ...manual, taxRate: e.target.value })
                }
                placeholder="Leave blank if not stated"
                inputMode="decimal"
              />
            </label>
          </div>
          {manual.kind === "service" && (
            <>
              <label className="form-label">
                Billing basis
                <input
                  value={manual.billingBasis}
                  onChange={(e) =>
                    setManual({ ...manual, billingBasis: e.target.value })
                  }
                  placeholder="e.g. fixed project, hourly, monthly"
                  required
                />
              </label>
              <label className="form-label">
                Scope
                <input
                  value={manual.scope}
                  onChange={(e) =>
                    setManual({ ...manual, scope: e.target.value })
                  }
                  required
                />
              </label>
            </>
          )}
          {quotation.sources.length > 0 && (
            <label className="form-label">
              Source evidence (optional)
              <select
                multiple
                value={manualSourceIds}
                onChange={(e) =>
                  setManualSourceIds(
                    Array.from(e.target.selectedOptions, (o) => o.value),
                  )
                }
              >
                {quotation.sources.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.sheet
                      ? `${s.sheet}!${s.cell}`
                      : s.page
                        ? `Page ${s.page}`
                        : `Text ${s.start ?? 0}`}{" "}
                    — {s.text.slice(0, 100)}
                  </option>
                ))}
              </select>
              <small>
                Select the original records supporting this item. Unlinked
                entries stay in review and cannot support a price recommendation.
              </small>
            </label>
          )}
          <label className="form-label">
            Review note
            <textarea
              value={manual.reason}
              onChange={(e) => setManual({ ...manual, reason: e.target.value })}
              required
              rows={2}
            />
          </label>
          <div className="modal-actions">
            <button className="button primary" disabled={saving}>
              Add item
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
