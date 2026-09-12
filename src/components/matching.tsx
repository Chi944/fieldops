"use client";
import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCheck,
  GitMerge,
  Layers,
  RotateCcw,
  Scissors,
  ShieldCheck,
  X,
} from "lucide-react";
import type {
  Comparison,
  MatchClassification,
  MatchGroup,
} from "@/lib/domain/types";
import { valueOf } from "@/lib/domain/types";
import { proposeMatches } from "@/lib/domain/matching";
import { api, useWorkspace } from "./context";
import { Badge, EmptyState, formatMoney, Modal, supplierName } from "./ui";

export function MatchingScreen({ comparison }: { comparison: Comparison }) {
  const { save, refresh, capabilities, toast } = useWorkspace();
  const [filter, setFilter] = useState("all"),
    [regroup, setRegroup] = useState<{
      groupId: string;
      quotationId: string;
      itemId: string;
    } | null>(null),
    [targetGroup, setTargetGroup] = useState("");
  const needsReview = comparison.groups.filter(group => group.status === "proposed" || group.status === "stale");
  const alternatives = comparison.groups.filter(group => group.classification === "alternative");
  const unmatched = comparison.groups.filter(group => new Set(group.members.map(member => member.quotationId)).size < 2);
  const itemCount = comparison.quotations.reduce((count, quotation) => count + quotation.items.length, 0);
  const groups = comparison.groups.filter(
    (g) =>
      filter === "all" ||
      (filter === "review"
        ? g.status === "proposed" || g.status === "stale"
        : filter === "unmatched" ? unmatched.some(group => group.id === g.id) : g.classification === "alternative"),
  );
  const approved = comparison.groups.filter(
    (g) => g.status === "approved" && g.classification === "equivalent",
  ).length;
  const update = async (id: string, patch: Partial<MatchGroup>) => {
    const next = structuredClone(comparison);
    Object.assign(next.groups.find((g) => g.id === id)!, patch);
    try {
      await save(next);
      toast(
        patch.status === "approved"
          ? "Match approved for this version of the quotation."
          : patch.status === "rejected"
            ? "Match rejected. The original items are preserved."
            : "Match group updated.",
      );
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const split = async (group: MatchGroup, itemId: string) => {
    const next = structuredClone(comparison),
      old = next.groups.find((g) => g.id === group.id)!;
    const member = old.members.find((m) => m.itemId === itemId)!;
    old.members = old.members.filter((m) => m.itemId !== itemId);
    old.status = "stale";
    old.approvedRevision = null;
    next.groups.push({
      ...structuredClone(old),
      id: crypto.randomUUID(),
      members: [member],
      label: `${old.label} — unmatched`,
      classification: "not_comparable",
      status: "proposed",
      explanation:
        "Separated by the reviewer. This item is not yet matched across suppliers.",
      acceptedOrderQuantities: {},
    });
    try {
      await save(next);
      toast("Item separated into an unmatched group.");
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <>
      <div className="section-heading matching-heading">
        <div>
          <h2>Review which offers belong together</h2>
          <p>
            Check specifications, quantities and service scope before approving a match.
          </p>
        </div>
        <Badge tone="teal">
          <CheckCheck size={13} />
          {approved} of {comparison.groups.length} groups approved
        </Badge>
      </div>
      <div className="matching-review-summary" aria-label="Matching review progress">
        <div><strong>{needsReview.length}</strong><span>groups to review</span></div>
        <div><strong>{unmatched.length}</strong><span>unmatched groups</span></div>
        <div><strong>{approved}</strong><span>equivalent groups approved</span></div>
        <p>{needsReview.some(group => group.status === "stale") ? "Some quotations or groupings changed. Review those matches again before comparing costs." : unmatched.length ? "Unmatched items remain visible. Move a suitable offer into a group, or keep it separate." : approved ? "Approved matches are ready for the quantity and cost checks in your comparison." : "Review each suggested group against the original quotations. Approval records your equivalence decision."}</p>
      </div>
      <div className="matching-guidance">
        <ShieldCheck size={19} />
        <span>
          Only approved equivalent items contribute to comparable costs.
          Package constraints, missing costs and source discrepancies are checked separately.
        </span>
      </div>
      <div className="matching-controls">
        <div className="segmented">
          <button
            className={filter === "all" ? "active" : ""}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All groups <span>{comparison.groups.length}</span>
          </button>
          <button
            className={filter === "review" ? "active" : ""}
            aria-pressed={filter === "review"}
            onClick={() => setFilter("review")}
          >
            Needs review <span>{needsReview.length}</span>
          </button>
          <button
            className={filter === "alternatives" ? "active" : ""}
            aria-pressed={filter === "alternatives"}
            onClick={() => setFilter("alternatives")}
          >
            Alternatives <span>{alternatives.length}</span>
          </button>
          <button className={filter === "unmatched" ? "active" : ""} aria-pressed={filter === "unmatched"} onClick={() => setFilter("unmatched")}>Unmatched <span>{unmatched.length}</span></button>
        </div>
        <button
          className="button secondary small"
          onClick={async () => {
            try {
              if (comparison.isDemo)
                await save({
                  ...comparison,
                  groups: proposeMatches(comparison.quotations),
                });
              else {
                await api(`/api/comparisons/${comparison.id}/matches/propose`, {
                  method: "POST",
                  body: JSON.stringify({
                    baseRevision: comparison.revision,
                    mode: "baseline",
                  }),
                });
                await refresh(comparison.id);
              }
              toast(
                "Identifier/text baseline refreshed. No AI was used. Review before approving.",
              );
            } catch (e) {
              toast((e as Error).message, true);
            }
          }}
        >
          <RotateCcw size={14} />
          Refresh baseline
        </button>
        {!comparison.isDemo && capabilities.canExtract && (
          <button
            className="button primary small"
            onClick={async () => {
              try {
                await api(`/api/comparisons/${comparison.id}/matches/propose`, {
                  method: "POST",
                  body: JSON.stringify({
                    baseRevision: comparison.revision,
                    mode: "ai",
                  }),
                });
                await refresh(comparison.id);
                toast("AI proposals ready for buyer review.");
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          >
            Suggest with AI
          </button>
        )}
      </div>
      <p className="small muted">
        {comparison.isDemo
          ? "Saved demonstration suggestions with identifier/text baseline refresh."
          : "Identifier/text baseline is available without AI. AI suggestions require a configured free account."}
        {" "}Refreshing replaces current groupings and approvals.
      </p>
      {groups.length === 0 ? (
        <EmptyState
          title={
            !comparison.quotations.length ? "Add quotations to match items" : !itemCount ? "Review your quotation items first" : !comparison.groups.length ? "Your items are ready to group" : filter === "review" ? "No groups waiting for review" : filter === "unmatched" ? "No unmatched groups" : "No alternatives in this view"
          }
          description={
            !comparison.quotations.length ? "Add supplier quotations, then review their extracted or manually entered items." : !itemCount ? "Check the original quotations and add missing items in extraction review." : !comparison.groups.length ? "Refresh the baseline to suggest groups from the available item descriptions and identifiers." : filter === "review" ? "Approved and rejected groups remain available under All groups. Approval does not resolve missing prices or terms." : "All source items remain available in the full group list."
          }
          action={!comparison.quotations.length ? <Link className="button primary" href={`/comparisons/${comparison.id}/upload`}>Add quotations <ArrowRight size={15} /></Link> : !itemCount ? <Link className="button primary" href={`/comparisons/${comparison.id}/review`}>Review quotation items <ArrowRight size={15} /></Link> : comparison.groups.length ? <button className="button secondary" onClick={() => setFilter("all")}>Show all groups</button> : undefined}
        />
      ) : (
        <div className="match-groups">
          {groups.map((group, groupIndex) => (
            <section
              className={`match-group ${group.classification}`}
              key={group.id}
            >
              <div className="match-group-heading">
                <div>
                  <span className="group-number">
                    {String(groupIndex + 1).padStart(2, "0")}
                  </span>
                  <h3>{group.label}</h3>
                  <Badge
                    tone={
                      group.classification === "equivalent" ? "teal" : "amber"
                    }
                  >
                    {group.classification === "equivalent"
                      ? "Equivalent items"
                      : group.classification === "alternative"
                        ? "Possible alternative"
                        : "Not directly comparable"}
                  </Badge>
                </div>
                <Badge
                  tone={
                    group.status === "approved"
                      ? "teal"
                      : group.status === "stale"
                        ? "amber"
                        : "neutral"
                  }
                >
                  {group.status === "approved" ? <Check size={12} /> : null}
                  {group.status === "stale" ? "Review again" : group.status}
                </Badge>
              </div>
              <div className="match-members">
                {group.members.map((member) => {
                  const quotation = comparison.quotations.find(
                      (q) => q.id === member.quotationId,
                    ),
                    item = quotation?.items.find((i) => i.id === member.itemId);
                  if (!quotation || !item) return null;
                  return (
                    <div
                      className="match-member"
                      key={`${member.quotationId}-${member.itemId}`}
                    >
                      <div className="match-member-supplier">
                        <span className="status-dot" />
                        {supplierName(quotation)}
                      </div>
                      <strong>
                        {valueOf(item.description) ?? "Description missing"}
                      </strong>
                      <div className="match-spec">
                        <span>
                          {valueOf(item.identifier) ?? "No identifier"}
                        </span>
                        <span>
                          {valueOf(item.quantity) ?? "?"}{" "}
                          {valueOf(item.unit) ?? "unit not stated"}
                        </span>
                        {valueOf(item.packageSize) && (
                          <span>
                            {valueOf(item.packageSize)}{" "}
                            {valueOf(item.packageUnit)} per {valueOf(item.unit)}
                          </span>
                        )}
                        {valueOf(item.billingBasis) && (
                          <span>{valueOf(item.billingBasis)?.replaceAll("_", " ")}</span>
                        )}
                      </div>
                      <Link className="match-source-link" href={`/comparisons/${comparison.id}/review?q=${encodeURIComponent(quotation.id)}`} aria-label={`Review source for ${valueOf(item.description) ?? "item"} from ${supplierName(quotation)}`}>Review source <ArrowRight size={12} /></Link>
                      <div className="match-member-price">
                        <span className="money">
                          {formatMoney(
                            valueOf(item.unitPrice),
                            valueOf(item.currency) ?? "",
                          )}
                        </span>
                        <small>/{valueOf(item.unit) ?? "unit"}</small>
                        <div>
                          <button
                            className="icon-button"
                            aria-label={`Move ${valueOf(item.description)} from ${supplierName(quotation)} to another group`}
                            onClick={() => {
                              setRegroup({ groupId: group.id, ...member });
                              setTargetGroup("");
                            }}
                          >
                            <GitMerge size={14} />
                          </button>
                          {group.members.length > 1 && (
                            <button
                              className="icon-button"
                              aria-label={`Split ${valueOf(item.description)} from ${supplierName(quotation)} out of this group`}
                              onClick={() => void split(group, item.id)}
                            >
                              <Scissors size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {comparison.quotations
                  .filter(
                    (q) => !group.members.some((m) => m.quotationId === q.id),
                  )
                  .map((q) => (
                    <div key={q.id} className="match-member missing-member">
                      <span className="match-member-supplier">
                        {supplierName(q)}
                      </span>
                      <Layers size={22} />
                      <strong>No matched item</strong>
                      <p>
                        The quotation does not include a matched offer in this
                        group.
                      </p>
                    </div>
                  ))}
              </div>
              <div className="match-explanation">
                {group.classification === "equivalent" ? (
                  <ShieldCheck size={16} />
                ) : (
                  <AlertTriangle size={16} />
                )}
                <p>{group.explanation}</p>
              </div>
              {(group.members.length < 2 || group.status === "stale" || group.classification !== "equivalent") && <p className="match-next-action">{group.members.length < 2 ? "Move a comparable offer into this group, or keep it unmatched if another supplier has no equivalent offer." : group.classification !== "equivalent" ? "Inspect the differences. Keep as an alternative, or split items that need separate comparison." : "Check the changed items and their sources, then approve equivalence again if it still holds."}</p>}
              <div className="match-group-actions">
                <label className="classification-select">
                  Treat as
                  <select
                    aria-label={`Classification for ${group.label}`}
                    value={group.classification}
                    onChange={(e) =>
                      update(group.id, {
                        classification: e.target.value as MatchClassification,
                        status: "proposed",
                        approvedRevision: null,
                      })
                    }
                  >
                    <option value="equivalent">Equivalent items</option>
                    <option value="alternative">Possible alternative</option>
                    <option value="not_comparable">
                      Not directly comparable
                    </option>
                  </select>
                </label>
                <div>
                  {group.status !== "rejected" && (
                    <button
                      className="button ghost small"
                      onClick={() =>
                        update(group.id, {
                          status: "rejected",
                          approvedRevision: null,
                        })
                      }
                    >
                      <X size={14} />
                      Reject match
                    </button>
                  )}
                  <button
                    className={`button small ${group.status === "approved" ? "secondary" : "primary"}`}
                    disabled={
                      group.members.length < 2 ||
                      group.status === "approved" ||
                      group.classification !== "equivalent"
                    }
                    onClick={() =>
                      update(group.id, {
                        status: "approved",
                        approvedRevision: comparison.revision + 1,
                      })
                    }
                  >
                    <Check size={15} />
                    {group.status === "approved"
                      ? "Approved"
                      : "Approve equivalence"}
                  </button>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
      <div className="section-bottom">
        <p>
          <ShieldCheck size={15} />
          Bundle prices are never split across invented items.
        </p>
        <Link
          className="button primary"
          href={`/comparisons/${comparison.id}/compare`}
        >
          Open comparison
          <ArrowRight size={16} />
        </Link>
      </div>
      <Modal
        open={!!regroup}
        onClose={() => setRegroup(null)}
        title="Move item to a group"
        description="The affected matches will need review again."
      >
        <label className="form-label">
          Destination group
          <select
            value={targetGroup}
            onChange={(e) => setTargetGroup(e.target.value)}
          >
            <option value="">Choose a group</option>
            {comparison.groups
              .filter(
                (g) =>
                  g.id !== regroup?.groupId &&
                  !g.members.some(
                    (m) => m.quotationId === regroup?.quotationId,
                  ),
              )
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
          </select>
        </label>
        <div className="modal-actions">
          <button
            className="button primary"
            disabled={!targetGroup}
            onClick={async () => {
              if (!regroup) return;
              const next = structuredClone(comparison),
                from = next.groups.find((g) => g.id === regroup.groupId)!,
                to = next.groups.find((g) => g.id === targetGroup)!;
              const member = from.members.find(
                (m) => m.itemId === regroup.itemId,
              )!;
              from.members = from.members.filter(
                (m) => m.itemId !== regroup.itemId,
              );
              to.members.push(member);
              for (const g of [from, to]) {
                g.status = "stale";
                g.approvedRevision = null;
                g.acceptedOrderQuantities = {};
              }
              next.groups = next.groups.filter((g) => g.members.length);
              try {
                await save(next);
                setRegroup(null);
                toast("Item regrouped. Review the updated equivalence.");
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          >
            Move item
          </button>
        </div>
      </Modal>
    </>
  );
}
