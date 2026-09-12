"use client";
import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCheck,
  Download,
  FileDown,
  FileText,
  Info,
  ListChecks,
  Loader2,
  MessageSquareText,
  Plus,
  Printer,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import type { Comparison, MatchGroup, Quotation } from "@/lib/domain/types";
import { valueOf } from "@/lib/domain/types";
import { calculateComparison, decimal } from "@/lib/domain/calculate";
import { comparisonWorkbook } from "@/lib/export";
import { useWorkspace } from "./context";
import {
  Badge,
  Brand,
  downloadBlob,
  EmptyState,
  formatMoney,
  initials,
  Modal,
  openOriginal,
  SourceDocument,
  supplierName,
} from "./ui";

type Evidence = { quotation: Quotation; ids: string[]; title: string };
export function ComparisonScreen({
  comparison,
  printable = false,
}: {
  comparison: Comparison;
  printable?: boolean;
}) {
  const { save, toast } = useWorkspace();
  const calculation = useMemo(
    () => calculateComparison(comparison),
    [comparison],
  );
  const [basis, setBasis] = useState<"scenario" | "quoted">("scenario"),
    [evidence, setEvidence] = useState<Evidence | null>(null),
    [quantities, setQuantities] = useState(false),
    [preferences, setPreferences] = useState(false),
    [query] = useState("");
  const [draftGroups, setDraftGroups] = useState<MatchGroup[]>([]),
    [notes, setNotes] = useState(comparison.preferences.notes),
    [priority, setPriority] = useState(comparison.preferences.priority);
  const [fxDialog, setFxDialog] = useState(false),
    [fx, setFx] = useState({
      from: "USD",
      to: "SGD",
      rate: "",
      date: new Date().toISOString().slice(0, 10),
      source: "",
    });
  const issues = comparison.quotations
    .flatMap((q) => q.issues)
    .filter((i) => !i.resolved);
  const comparableCount = comparison.groups.filter(
    (g) => g.classification === "equivalent" && g.status === "approved",
  ).length;
  const currencies = [
    ...new Set(
      comparison.quotations.map((q) => valueOf(q.currency)).filter(Boolean),
    ),
  ];
  const showEvidence = (q: Quotation, ids: string[], title: string) =>
    setEvidence({ quotation: q, ids, title });
  if (!comparison.quotations.length)
    return (
      <EmptyState
        title="Your comparison is ready for quotations"
        description="Add supplier quotations, review their evidence and approve comparable items to build your matrix."
        action={
          <Link
            className="button primary"
            href={`/comparisons/${comparison.id}/upload`}
          >
            <Plus size={16} />
            Add quotations
          </Link>
        }
      />
    );
  return (
    <>
      {!printable && (
        <>
          <div className="comparison-summary-strip">
            <div>
              <span className="summary-icon">
                <CheckCheck size={18} />
              </span>
              <strong>{comparableCount}</strong>
              <span>approved item groups</span>
            </div>
            <span className="summary-separator" />
            <div>
              <span className="summary-icon amber-icon">
                <AlertCircle size={18} />
              </span>
              <strong>{issues.length}</strong>
              <span>issues to clarify</span>
            </div>
            <span className="summary-separator" />
            <div>
              <span className="summary-icon">
                <FileText size={18} />
              </span>
              <strong>{comparison.quotations.length}</strong>
              <span>original quotations</span>
            </div>
            <button
              className="text-button"
              onClick={() => setPreferences(true)}
            >
              <Settings2 size={15} />
              Comparison preferences
            </button>
          </div>
          {issues.length > 0 && (
            <div className="comparison-alert">
              <AlertCircle size={18} />
              <p>
                <strong>A few details could change this decision.</strong>{" "}
                {issues.some((i) => i.code === "amount_mismatch")
                  ? "A quoted amount does not reconcile. "
                  : ""}
                Review missing terms and non-comparable items before choosing a
                supplier.
              </p>
              <Link href={`/comparisons/${comparison.id}/review`}>
                Review issues
                <ArrowRight size={15} />
              </Link>
            </div>
          )}
          <div className="matrix-heading">
            <div>
              <h2>Supplier comparison</h2>
              <p>Original prices. Reviewed equivalence. Clear differences.</p>
            </div>
            <div className="matrix-tools">
              <div className="segmented">
                <button
                  className={basis === "scenario" ? "active" : ""}
                  onClick={() => setBasis("scenario")}
                >
                  Required quantities
                </button>
                <button
                  className={basis === "quoted" ? "active" : ""}
                  onClick={() => setBasis("quoted")}
                >
                  As quoted
                </button>
              </div>
              <button
                className="button secondary small"
                onClick={() => {
                  setDraftGroups(structuredClone(comparison.groups));
                  setQuantities(true);
                }}
              >
                <Settings2 size={14} />
                Quantities
              </button>
            </div>
          </div>
        </>
      )}
      {currencies.length > 1 && (
        <div className="currency-notice">
          <Info size={15} />
          <p>
            Original currencies are kept separate: {currencies.join(", ")}.
            Cross-currency prices are not ranked.
          </p>
          {!printable && (
            <button className="text-button" onClick={() => setFxDialog(true)}>
              Add an exchange rate
            </button>
          )}
        </div>
      )}
      {!printable && <p className="matrix-scroll-hint">Scroll across the matrix to compare supplier offers.<ArrowRight size={14} /></p>}
      <div className="matrix-scroll" style={{ "--matrix-min-width": `${240 + comparison.quotations.length * 230}px` } as CSSProperties} tabIndex={printable ? undefined : 0} aria-label="Supplier matrix. Scroll to compare items and suppliers.">
        <table className="comparison-matrix">
          <caption className="sr-only">
            {comparison.name} —{" "}
            {basis === "scenario"
              ? "comparison at required quantities"
              : "original quoted amounts"}
          </caption>
          <thead>
            <tr>
              <th className="item-column">
                <span className="matrix-col-label">Items & requirements</span>
                <small>{comparison.groups.length} item groups</small>
              </th>
              {comparison.quotations.map((q, index) => (
                <th key={q.id}>
                  <div className="supplier-heading">
                    <span className={`supplier-avatar color-${index}`}>
                      {initials(supplierName(q))}
                    </span>
                    <div>
                      <strong>{supplierName(q)}</strong>
                      <small>
                        {valueOf(q.quotationNumber) ?? "No reference"}
                      </small>
                    </div>
                  </div>
                  <div className="supplier-heading-footer">
                    <Badge>{valueOf(q.currency) ?? "Currency missing"}</Badge>
                    <button
                      className="text-button"
                      onClick={() => openOriginal(q)}
                    >
                      Original quote
                      <ArrowUpRight size={12} />
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.groups
              .filter((g) =>
                g.label.toLowerCase().includes(query.toLowerCase()),
              )
              .map((group, groupIndex) => {
                const calculated = calculation.groups.find(
                  (g) => g.groupId === group.id,
                )!;
                return (
                  <tr
                    key={group.id}
                    className={
                      group.classification !== "equivalent"
                        ? "alternative-row"
                        : ""
                    }
                  >
                    <th scope="row" className="item-column">
                      <div className="matrix-item-title">
                        <span>{String(groupIndex + 1).padStart(2, "0")}</span>
                        <strong>{group.label}</strong>
                      </div>
                      <div className="matrix-item-details">
                        <span>
                          {group.requiredQuantity} {group.requiredUnit} required
                        </span>
                        {group.billingPeriods && (
                          <span>{group.billingPeriods} billing periods</span>
                        )}
                      </div>
                      <Badge
                        tone={
                          group.classification !== "equivalent" ||
                          group.status !== "approved"
                            ? "amber"
                            : "teal"
                        }
                      >
                        {group.classification !== "equivalent" ? (
                          "Alternative / scope differs"
                        ) : group.status === "approved" ? (
                          <>
                            <Check size={11} />
                            Match reviewed
                          </>
                        ) : (
                          "Match needs review"
                        )}
                      </Badge>
                    </th>
                    {comparison.quotations.map((q) => {
                      const member = group.members.find(
                          (m) => m.quotationId === q.id,
                        ),
                        item = q.items.find((i) => i.id === member?.itemId),
                        computed = calculated.values.find(
                          (v) => v.quotationId === q.id,
                        );
                      const lowest =
                        basis === "scenario" &&
                        calculated.lowestQuotationIds.includes(q.id);
                      if (!item || !computed)
                        return (
                          <td key={q.id} className="missing-cell">
                            <span>Not quoted</span>
                            <small>No matched offer</small>
                          </td>
                        );
                      const amount =
                          basis === "quoted"
                            ? valueOf(item.lineAmount)
                            : computed.amount,
                        currency = valueOf(item.currency) ?? "";
                      return (
                        <td key={q.id} className={lowest ? "lowest-cell" : ""}>
                          <button
                            className="matrix-value-button"
                            onClick={() =>
                              showEvidence(
                                q,
                                item.sourceIds,
                                valueOf(item.description) ?? group.label,
                              )
                            }
                          >
                            <div className="matrix-price">
                              <strong className="money">
                                {formatMoney(amount, currency)}
                              </strong>
                              {lowest && (
                                <span className="lowest-label">
                                  <ArrowDown size={11} />
                                  Lowest
                                </span>
                              )}
                              {computed.discrepancy && (
                                <AlertCircle
                                  size={15}
                                  className="discrepancy-icon"
                                  aria-label="Quoted amount discrepancy"
                                />
                              )}
                            </div>
                            <span className="unit-price">
                              {formatMoney(valueOf(item.unitPrice), currency)} /{" "}
                              {valueOf(item.unit) ?? "unit not stated"}
                            </span>
                            <span className="quoted-description">
                              {valueOf(item.description)}
                            </span>
                            {computed.orderQuantity && basis === "scenario" && (
                              <span className="order-detail">
                                {computed.orderQuantity} {computed.orderUnit}
                                {computed.surplus &&
                                decimal(computed.surplus)?.gt(0)
                                  ? ` · ${computed.surplus} ${group.requiredUnit} surplus`
                                  : ""}
                              </span>
                            )}
                            <span className="cell-evidence">
                              View evidence
                              <ArrowUpRight size={11} />
                            </span>
                          </button>
                          {basis === "scenario" &&
                            computed.status !== "eligible" && (
                              <div className="cell-review-note">
                                <AlertCircle size={12} />
                                <span>
                                  {group.classification !== "equivalent"
                                    ? "Scope or billing basis differs"
                                    : group.status !== "approved"
                                      ? "Approve this match before comparing"
                                      : (computed.reasons[0] ??
                                        "Review required")}
                                </span>
                              </div>
                            )}
                          {basis === "scenario" &&
                            computed.orderQuantity &&
                            computed.reasons.some((r) =>
                              r.startsWith("Accept ordering"),
                            ) &&
                            !printable && (
                              <button
                                className="text-button accept-order"
                                onClick={async () => {
                                  const next = structuredClone(comparison),
                                    g = next.groups.find(
                                      (x) => x.id === group.id,
                                    )!;
                                  g.acceptedOrderQuantities[q.id] =
                                    computed.orderQuantity!;
                                  g.status = "stale";
                                  g.approvedRevision = null;
                                  try {
                                    await save(next);
                                    toast(
                                      "Order quantity accepted. Review the updated match; excess units remain visible.",
                                    );
                                  } catch (e) {
                                    toast((e as Error).message, true);
                                  }
                                }}
                              >
                                Accept {computed.orderQuantity}{" "}
                                {computed.orderUnit}
                              </button>
                            )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            <tr className="matrix-section-row">
              <th colSpan={comparison.quotations.length + 1}>
                <span>Commercial terms</span>
                <span>These details belong in the decision too.</span>
              </th>
            </tr>
            {(
              [
                ["leadTime", "Lead time"],
                ["payment", "Payment terms"],
                ["delivery", "Delivery"],
                ["warranty", "Warranty"],
              ] as const
            ).map(([key, label]) => (
              <tr className="terms-row" key={key}>
                <th scope="row" className="item-column">
                  {label}
                </th>
                {comparison.quotations.map((q) => {
                  const f = q.terms[key];
                  return (
                    <td key={q.id}>
                      <button
                        className={`term-value ${f.state !== "value" ? "missing" : ""}`}
                        onClick={() => showEvidence(q, f.sourceIds, label)}
                      >
                        {f.state === "value" ? (
                          f.value
                        ) : (
                          <>
                            <AlertCircle size={12} />
                            {f.state === "ambiguous"
                              ? "Needs clarification"
                              : "Not stated"}
                          </>
                        )}
                        {f.state === "value" && <ArrowUpRight size={10} />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="matrix-total-row">
              <th className="item-column" scope="row">
                <strong>
                  {basis === "quoted"
                    ? "Supplier-stated total"
                    : "Known comparable subtotal"}
                </strong>
                <small>
                  {basis === "quoted"
                    ? "At original quoted quantities"
                    : "Partial coverage · order-level charges excluded"}
                </small>
              </th>
              {comparison.quotations.map((q) => {
                const total = calculation.suppliers.find(
                  (s) => s.quotationId === q.id,
                )!;
                return (
                  <td key={q.id}>
                    <strong className="money">
                      {formatMoney(
                        basis === "quoted"
                          ? valueOf(q.statedTotal)
                          : total.subtotal,
                        total.currency ?? "",
                      )}
                    </strong>
                    <small>
                      {basis === "scenario"
                        ? `${total.coverage} / ${total.requiredGroups} requirement groups eligible`
                        : "Original stated amount preserved"}
                    </small>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="matrix-caption">
        <span>
          <ShieldCheck size={13} />
          Lowest applies only to approved, comparable line costs.
        </span>
        <span>Unknown costs are excluded, never treated as zero.</span>
      </div>
      {comparison.exchangeRates.length > 0 && (
        <section className="fx-section">
          <h3>User-supplied currency references</h3>
          {comparison.exchangeRates.map((rate) => (
            <div key={rate.id}>
              <strong>
                1 {rate.from} = {rate.rate} {rate.to}
              </strong>
              <span>
                {rate.date} · {rate.source}
              </span>
              {calculation.suppliers
                .filter((s) => s.currency === rate.from && s.subtotal)
                .map((s) => (
                  <small key={s.quotationId}>
                    {s.supplierName}: {formatMoney(s.subtotal, rate.from)} →{" "}
                    {formatMoney(
                      decimal(s.subtotal)?.mul(rate.rate).toFixed(2),
                      rate.to,
                    )}{" "}
                    · converted subtotal, same coverage limitations
                  </small>
                ))}
            </div>
          ))}
        </section>
      )}
      <div
        className={`decision-section priority-${comparison.preferences.priority}`}
      >
        <div className="section-heading">
          <div>
            <h2>What this comparison tells you</h2>
            <p>Evidence to support a decision, with the limits kept in view.</p>
          </div>
          <Badge>
            <ListChecks size={12} />
            Transparent criteria
          </Badge>
        </div>
        <div className="decision-grid">
          <article className="decision-card">
            <span className="decision-icon">
              <ArrowDownRight size={21} />
            </span>
            <h3>Lowest comparable cost</h3>
            <p>
              {calculation.groups.some((g) => g.lowestQuotationIds.length)
                ? `${calculation.groups.filter((g) => g.lowestQuotationIds.length).length} approved item groups have a comparable lowest price. The highlighted values exclude order-level charges.`
                : "There is not enough approved, comparable information to identify a lowest price."}
            </p>
            <div className="decision-bottom">
              <Info size={13} />
              <span>
                {calculation.suppliers.every((s) => s.eligible)
                  ? "Compare the complete requirement set."
                  : "No overall supplier winner: coverage or costs are incomplete."}
              </span>
            </div>
          </article>
          <article className="decision-card">
            <span className="decision-icon amber-icon">
              <CalendarClock size={20} />
            </span>
            <h3>Earliest stated lead time</h3>
            <p>
              {
                calculation.recommendations.find((r) => r.kind === "lead_time")
                  ?.message
              }
            </p>
            <div className="lead-time-list">
              {comparison.quotations.map((q) => (
                <button
                  key={q.id}
                  onClick={() =>
                    showEvidence(
                      q,
                      q.terms.leadTime.sourceIds,
                      "Stated lead time",
                    )
                  }
                >
                  <span>{supplierName(q)}</span>
                  <strong>{valueOf(q.terms.leadTime) ?? "Not stated"}</strong>
                </button>
              ))}
            </div>
            <div className="decision-bottom">
              <Info size={13} />
              <span>Stated lead times are not guaranteed delivery dates.</span>
            </div>
          </article>
          <article className="decision-card">
            <span className="decision-icon amber-icon">
              <MessageSquareText size={20} />
            </span>
            <h3>Clarify before committing</h3>
            <ul>
              {issues.slice(0, 3).map((i) => (
                <li key={i.id}>{i.message}</li>
              ))}
              {issues.length === 0 && (
                <li>
                  Review exclusions and confirm terms remain valid for your
                  required quantities.
                </li>
              )}
            </ul>
            <Link href={`/comparisons/${comparison.id}/review`}>
              Review source issues
              <ArrowRight size={14} />
            </Link>
          </article>
        </div>
        <div className="requirements-note">
          <ListChecks size={18} />
          <div>
            <strong>Your requirements</strong>
            <p>
              {
                calculation.recommendations.find(
                  (r) => r.kind === "requirements",
                )?.message
              }
            </p>
            {comparison.preferences.notes && (
              <p>{comparison.preferences.notes}</p>
            )}
            <small>
              Free-text requirements are a review checklist; no unsupported fit
              score is assigned.
            </small>
          </div>
        </div>
      </div>
      {!printable && (
        <div className="section-bottom">
          <p>
            Ready to share? Your report includes the assumptions and open
            questions.
          </p>
          <Link
            className="button primary"
            href={`/comparisons/${comparison.id}/export`}
          >
            <FileDown size={16} />
            Prepare report
          </Link>
        </div>
      )}
      <Modal
        open={!!evidence}
        onClose={() => setEvidence(null)}
        title={evidence?.title ?? "Source evidence"}
        description="Evidence references are preserved from the source parser."
        wide
      >
        {evidence && (
          <SourceDocument
            quotation={evidence.quotation}
            selectedSourceIds={evidence.ids}
          />
        )}
      </Modal>
      <Modal
        open={quantities}
        onClose={() => setQuantities(false)}
        title="Required quantities"
        description="Changing demand invalidates affected approvals. Package and MOQ surplus require explicit acceptance."
        wide
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const next = structuredClone(comparison);
            next.groups = draftGroups.map((g) => {
              const old = comparison.groups.find((x) => x.id === g.id)!;
              if (
                old.requiredQuantity !== g.requiredQuantity ||
                old.requiredUnit !== g.requiredUnit ||
                old.billingPeriods !== g.billingPeriods
              )
                return {
                  ...g,
                  status: "stale",
                  approvedRevision: null,
                  acceptedOrderQuantities: {},
                };
              return g;
            });
            try {
              await save(next);
              setQuantities(false);
              toast("Requirements updated. Review affected matches again.");
            } catch (error) {
              toast((error as Error).message, true);
            }
          }}
        >
          <div className="quantity-list">
            {draftGroups.map((g, i) => (
              <div key={g.id}>
                <strong>{g.label}</strong>
                <label>
                  Quantity
                  <input
                    aria-label={`Required quantity for ${g.label}`}
                    value={g.requiredQuantity}
                    onChange={(e) =>
                      setDraftGroups((all) =>
                        all.map((x, j) =>
                          j === i
                            ? { ...x, requiredQuantity: e.target.value }
                            : x,
                        ),
                      )
                    }
                    inputMode="decimal"
                    required
                    pattern="[0-9]+(\.[0-9]+)?"
                  />
                </label>
                <label>
                  Unit
                  <input
                    aria-label={`Required unit for ${g.label}`}
                    value={g.requiredUnit}
                    onChange={(e) =>
                      setDraftGroups((all) =>
                        all.map((x, j) =>
                          j === i ? { ...x, requiredUnit: e.target.value } : x,
                        ),
                      )
                    }
                    required
                  />
                </label>
                {g.billingPeriods !== null && (
                  <label>
                    Billing periods
                    <input
                      aria-label={`Billing periods for ${g.label}`}
                      value={g.billingPeriods}
                      onChange={(e) =>
                        setDraftGroups((all) =>
                          all.map((x, j) =>
                            j === i
                              ? { ...x, billingPeriods: e.target.value }
                              : x,
                          ),
                        )
                      }
                      inputMode="numeric"
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => setQuantities(false)}
            >
              Cancel
            </button>
            <button className="button primary">Save requirements</button>
          </div>
        </form>
      </Modal>
      <Modal
        open={preferences}
        onClose={() => setPreferences(false)}
        title="Comparison preferences"
        description="Record what matters to you. Missing information will never be scored favourably."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await save({ ...comparison, preferences: { priority, notes } });
              setPreferences(false);
              toast("Comparison priorities saved.");
            } catch (error) {
              toast((error as Error).message, true);
            }
          }}
        >
          <label className="form-label">
            Primary consideration
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
            >
              <option value="cost">Lowest comparable cost</option>
              <option value="lead_time">Explicit lead time</option>
              <option value="requirements">Match to requirements</option>
            </select>
          </label>
          <label className="form-label">
            Requirements and notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder="e.g. Installation and a two-year warranty are required."
            />
          </label>
          <p className="small muted">
            Priorities document your criteria; they do not create a weighted
            score or hide missing terms.
          </p>
          <div className="modal-actions">
            <button className="button primary">Save preferences</button>
          </div>
        </form>
      </Modal>
      <Modal
        open={fxDialog}
        onClose={() => setFxDialog(false)}
        title="Record an exchange rate"
        description="Use a rate you have sourced. Originals remain visible and converted subtotals keep the same limitations."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!decimal(fx.rate)?.gt(0) || fx.from === fx.to) {
              toast(
                "Enter a positive rate between different currencies.",
                true,
              );
              return;
            }
            try {
              await save({
                ...comparison,
                exchangeRates: [
                  ...comparison.exchangeRates,
                  { id: crypto.randomUUID(), ...fx },
                ],
              });
              setFxDialog(false);
              toast("Exchange rate and source recorded.");
            } catch (error) {
              toast((error as Error).message, true);
            }
          }}
        >
          <div className="form-grid">
            {(
              [
                ["from", "From currency"],
                ["to", "To currency"],
                ["rate", "1 from currency equals"],
                ["date", "Rate date"],
              ] as const
            ).map(([key, label]) => (
              <label className="form-label" key={key}>
                {label}
                <input
                  value={fx[key]}
                  onChange={(e) =>
                    setFx({
                      ...fx,
                      [key]: ["from", "to"].includes(key)
                        ? e.target.value.toUpperCase()
                        : e.target.value,
                    })
                  }
                  type={key === "date" ? "date" : "text"}
                  required
                  maxLength={["from", "to"].includes(key) ? 3 : undefined}
                />
              </label>
            ))}
          </div>
          <label className="form-label">
            Source
            <input
              value={fx.source}
              onChange={(e) => setFx({ ...fx, source: e.target.value })}
              placeholder="e.g. Treasury rate sheet, 13 September"
              required
            />
          </label>
          <div className="modal-actions">
            <button className="button primary">Save exchange rate</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ReportScreen({ comparison }: { comparison: Comparison }) {
  const { toast } = useWorkspace();
  const [exporting, setExporting] = useState(false);
  const [snapshot] = useState(() => structuredClone(comparison));
  const [reportDate] = useState(() => new Date().toISOString());
  const download = async () => {
    setExporting(true);
    try {
      const bytes = await comparisonWorkbook(snapshot, {
        sourceOrigin: window.location.origin,
        calculatedAt: reportDate,
      });
      downloadBlob(
        new Blob([bytes.buffer as ArrayBuffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `FieldOps-${snapshot.name.replace(/[^a-z0-9]+/gi, "-")}-r${snapshot.revision}.xlsx`,
      );
      toast(
        "Excel report exported with sources, assumptions and review issues.",
      );
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setExporting(false);
    }
  };
  const issues = snapshot.quotations
    .flatMap((q) => q.issues)
    .filter((i) => !i.resolved);
  return (
    <>
      <div className="export-heading no-print">
        <div>
          <h2>A report you can stand behind.</h2>
          <p>
            Share the comparison, its evidence, and the questions still open.
          </p>
        </div>
        <div>
          <button className="button secondary" onClick={() => window.print()}>
            <Printer size={16} />
            Print / save PDF
          </button>
          <button
            className="button primary"
            onClick={download}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Download size={16} />
            )}
            Download Excel
          </button>
        </div>
      </div>
      {comparison.revision !== snapshot.revision && (
        <div className="notice-box no-print">
          This report keeps revision {snapshot.revision}. Reopen Export report
          to prepare the newer revision.
        </div>
      )}
      <div className="export-inclusions no-print">
        <span>
          <Check size={14} />
          Comparison matrix
        </span>
        <span>
          <Check size={14} />
          Original supplier values
        </span>
        <span>
          <Check size={14} />
          Sources & corrections
        </span>
        <span>
          <Check size={14} />
          Assumptions & open issues
        </span>
      </div>
      <article className="print-report">
        <div className="report-letterhead">
          <Brand />
          <span>Supplier quotation comparison</span>
        </div>
        <div className="report-title">
          <div>
            <h1>{snapshot.name}</h1>
            <p>{snapshot.description}</p>
          </div>
          <dl>
            <div>
              <dt>Prepared</dt>
              <dd>
                {new Date(reportDate).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </dd>
            </div>
            <div>
              <dt>Snapshot</dt>
              <dd>Revision {snapshot.revision}</dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>{issues.length} unresolved issues</dd>
            </div>
          </dl>
        </div>
        {snapshot.isDemo && (
          <p className="report-disclosure">
            Demonstration report · Fictional suppliers and saved sample
            extractions. No live AI performance is implied.
          </p>
        )}
        <ComparisonScreen comparison={snapshot} printable />
        <section className="report-assumptions">
          <h2>Assumptions & limitations</h2>
          <ul>
            <li>
              Only approved equivalent groups contribute to comparable
              subtotals. Partial coverage is labelled.
            </li>
            <li>
              Unknown shipping, taxes and other charges are not zero. Shown
              subtotals are not complete landed costs.
            </li>
            <li>
              Prices preserve original currencies. Any user-supplied rate is
              recorded separately with its source and date.
            </li>
            <li>
              Calculations use decimal arithmetic and currency rounding;
              supplier-stated discrepancies remain visible.
            </li>
            <li>
              Unclear service scope and incompatible billing periods remain
              non-comparable.
            </li>
          </ul>
        </section>
        <section className="report-issues">
          <h2>Open review issues</h2>
          {issues.length ? (
            issues.map((i) => (
              <div key={i.id}>
                <Badge tone={i.severity === "error" ? "red" : "amber"}>
                  {i.severity}
                </Badge>
                <p>{i.message}</p>
                <small>
                  {
                    snapshot.quotations.find(
                      (q) => q.documentId === i.documentId,
                    )?.filename
                  }{" "}
                  · {i.sourceIds.join(", ") || "No exact source location"}
                </small>
              </div>
            ))
          ) : (
            <p>
              No automatically flagged unresolved issues. Buyer review is still
              required.
            </p>
          )}
        </section>
        {snapshot.corrections.length > 0 && (
          <section className="report-assumptions">
            <h2>Correction audit</h2>
            <p>Reviewed changes are separate from supplier interpretations.</p>
            {snapshot.corrections.map((c) => (
              <article className="report-correction" key={c.id}>
                <strong>
                  {
                    snapshot.quotations.find((q) => q.id === c.quotationId)
                      ?.filename
                  }{" "}
                  · {c.path}
                </strong>
                <p>
                  {c.before.value ?? c.before.state} →{" "}
                  {c.after.value ?? c.after.state}
                </p>
                <p>{c.reason}</p>
                <small>
                  {c.author} · {c.createdAt}
                </small>
              </article>
            ))}
          </section>
        )}
        <section className="report-sources">
          <h2>Original quotations & source references</h2>
          {snapshot.quotations.map((q) => (
            <details key={q.id} open>
              <summary>
                <strong>{supplierName(q)}</strong>
                <span>
                  {q.filename} · extraction v{q.extractionVersion}
                </span>
              </summary>
              {q.sources.map((s) => (
                <div className="report-source-row" key={s.id}>
                  <code>{s.id}</code>
                  <p>{s.text}</p>
                  <small>
                    {s.page
                      ? `Page ${s.page}`
                      : s.sheet
                        ? `${s.sheet}!${s.cell}`
                        : `Text ${s.start ?? 0}–${s.end ?? s.text.length}`}
                  </small>
                </div>
              ))}
            </details>
          ))}
        </section>
        <footer className="report-footer">
          <Brand small />
          <span>
            Evidence-led comparisons. Final purchasing decisions remain with the
            buyer.
          </span>
        </footer>
      </article>
    </>
  );
}
