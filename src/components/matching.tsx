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
  const groups = comparison.groups.filter(
    (g) =>
      filter === "all" ||
      (filter === "review"
        ? g.status !== "approved"
        : g.classification === "alternative"),
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
          <h2>Compare like for like.</h2>
          <p>
            Review what belongs together. Similar descriptions are a starting
            point, not proof.
          </p>
        </div>
        <Badge tone="teal">
          <CheckCheck size={13} />
          {approved} of {comparison.groups.length} groups approved
        </Badge>
      </div>
      <div className="matching-guidance">
        <ShieldCheck size={19} />
        <span>
          Only approved equivalent items contribute to comparable costs.
          Alternatives keep their differences visible.
        </span>
      </div>
      <div className="matching-controls">
        <div className="segmented">
          <button
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            All groups <span>{comparison.groups.length}</span>
          </button>
          <button
            className={filter === "review" ? "active" : ""}
            onClick={() => setFilter("review")}
          >
            Needs review
          </button>
          <button
            className={filter === "alternatives" ? "active" : ""}
            onClick={() => setFilter("alternatives")}
          >
            Alternatives
          </button>
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
      </p>
      {groups.length === 0 ? (
        <EmptyState
          title={
            comparison.quotations.length
              ? "No groups in this view"
              : "Add quotations to match items"
          }
          description={
            comparison.quotations.length
              ? "Refresh suggestions after adding or correcting your quotation items."
              : "Extract or manually enter supplier items, then return here."
          }
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
                          <span>{valueOf(item.billingBasis)}</span>
                        )}
                      </div>
                      <div className="match-member-price">
                        <span className="money">
                          {formatMoney(
                            valueOf(item.unitPrice),
                            valueOf(item.currency) ?? "USD",
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
