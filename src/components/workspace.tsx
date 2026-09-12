"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileText,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { Comparison } from "@/lib/domain/types";
import { useWorkspace } from "./context";
import { Badge, EmptyState, initials } from "./ui";
import { valueOf } from "@/lib/domain/types";

export function WorkspaceScreen({
  onCreate,
  onRename,
  onDelete,
}: {
  onCreate: () => void;
  onRename: (c: Comparison) => void;
  onDelete: (c: Comparison) => void;
}) {
  const { comparisons, capabilities } = useWorkspace();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [menu, setMenu] = useState<string | null>(null);
  const allIssues = comparisons
    .flatMap((c) => c.quotations.flatMap((q) => q.issues))
    .filter((i) => !i.resolved).length;
  const quotations = comparisons.reduce(
    (count, c) => count + c.quotations.length,
    0,
  );
  const visible = useMemo(
    () =>
      comparisons.filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) &&
          (filter !== "review" ||
            c.quotations.some((q) => q.issues.some((i) => !i.resolved))),
      ),
    [comparisons, query, filter],
  );
  const featured =
    comparisons.find((c) => c.id === "demo-studio") ??
    comparisons.find((c) => c.quotations.length);
  return (
    <>
      <div className="workspace-heading">
        <div>
          <div className="welcome-line">
            <span className="status-dot" />
            Your procurement workspace
          </div>
          <h1>
            Good decisions start
            <br />
            with a clear comparison.
          </h1>
          <p>Bring your quotations together. Find what matters.</p>
        </div>
        <button className="button primary" onClick={onCreate}>
          <Plus size={17} />
          New comparison
        </button>
      </div>
      <section className="workspace-intro" aria-label="Workspace at a glance">
        <div className="intro-content">
          <Badge tone="teal">
            <ClipboardCheck size={12} />
            Evidence-led buying
          </Badge>
          <h2>
            Different suppliers.
            <br />
            One shared view.
          </h2>
          <p>
            Go beyond the headline price. Review the source, compare like for
            like, and keep the details that change a decision.
          </p>
          {featured && (
            <Link
              href={`/comparisons/${featured.id}/compare`}
              className="intro-link"
            >
              Explore a sample comparison <ArrowRight size={17} />
            </Link>
          )}
        </div>
        <div
          className="comparison-illustration"
          aria-label="Illustration of a comparison with three supplier quotations"
        >
          <div className="mini-quote back-one">
            <FileText size={18} />
            <i />
            <i />
            <i />
            <div className="mini-lines" />
          </div>
          <div className="mini-quote back-two">
            <FileText size={18} />
            <i />
            <i />
            <i />
            <div className="mini-lines" />
          </div>
          <div className="mini-matrix">
            <div className="mini-matrix-title">
              <span className="mini-mark">
                <Check size={13} />
              </span>
              Compare with confidence<span className="mini-dots">•••</span>
            </div>
            <div className="mini-matrix-grid">
              <span>Required items</span>
              <span>A</span>
              <span>B</span>
              <span>C</span>
              <b>Equipment</b>
              <i className="mini-bar" />
              <i className="mini-bar chosen" />
              <i className="mini-bar" />
              <b>Installation</b>
              <i className="mini-bar" />
              <i className="mini-warning" />
              <i className="mini-bar" />
              <b>Delivery</b>
              <i className="mini-bar chosen" />
              <i className="mini-bar" />
              <i className="mini-dash" />
            </div>
            <div className="mini-bottom">
              <span className="status-dot" />
              Every value linked to its source
              <Check size={13} />
            </div>
          </div>
        </div>
      </section>
      <div className="workspace-stats">
        <div>
          <span className="stat-icon">
            <FolderOpen size={19} />
          </span>
          <strong>{comparisons.length}</strong>
          <span>Comparisons</span>
        </div>
        <div>
          <span className="stat-icon">
            <FileText size={19} />
          </span>
          <strong>{quotations}</strong>
          <span>Supplier quotations</span>
        </div>
        <div>
          <span className="stat-icon amber-icon">
            <ClipboardCheck size={19} />
          </span>
          <strong>{allIssues}</strong>
          <span>Items to review</span>
        </div>
        <span className="stats-disclosure">
          {capabilities.canPersist
            ? "Samples and private comparisons"
            : "Realistic samples. No private documents."}
        </span>
      </div>
      <section className="comparisons-section">
        <div className="section-heading">
          <div>
            <h2>
              Your comparisons <span>{comparisons.length}</span>
            </h2>
            <p>Pick up where you left off, or start a new decision.</p>
          </div>
          <div className="search-control">
            <Search size={16} />
            <input
              aria-label="Search comparisons"
              placeholder="Search comparisons"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>/</kbd>
          </div>
        </div>
        <div className="list-controls">
          <div className="segmented">
            <button
              className={filter === "all" ? "active" : ""}
              onClick={() => setFilter("all")}
            >
              All comparisons
            </button>
            <button
              className={filter === "review" ? "active" : ""}
              onClick={() => setFilter("review")}
            >
              Needs review{allIssues > 0 && <span>{allIssues}</span>}
            </button>
          </div>
          <span className="muted small">Most recently updated</span>
        </div>
        {visible.length ? (
          <div className="comparison-list">
            <div className="comparison-list-head">
              <span>Comparison</span>
              <span>Suppliers</span>
              <span>Review status</span>
              <span>Updated</span>
              <span />
            </div>
            {[...visible]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((c) => {
                const unresolved = c.quotations
                  .flatMap((q) => q.issues)
                  .filter((i) => !i.resolved).length;
                return (
                  <div className="comparison-list-row" key={c.id}>
                    <Link
                      className="comparison-name"
                      href={`/comparisons/${c.id}/compare`}
                    >
                      <span className="comparison-folder">
                        <FolderOpen size={22} />
                      </span>
                      <span>
                        <strong>{c.name}</strong>
                        <small>
                          {c.description || "Ready for your quotations"}
                        </small>
                        <span className="comparison-meta">
                          {c.isDemo ? "Sample" : "Private"} <span>·</span>{" "}
                          {c.quotations.length} quotations <span>·</span>{" "}
                          {c.groups.length} item groups
                        </span>
                      </span>
                    </Link>
                    <div className="supplier-stack">
                      {c.quotations.slice(0, 3).map((q, i) => (
                        <span
                          key={q.id}
                          className={`supplier-avatar color-${i}`}
                          title={valueOf(q.supplier.name) ?? q.filename}
                        >
                          {initials(valueOf(q.supplier.name) ?? q.filename)}
                        </span>
                      ))}
                      {c.quotations.length === 0 && (
                        <span className="muted small">No suppliers yet</span>
                      )}
                    </div>
                    <div>
                      {unresolved ? (
                        <Badge tone="amber">
                          <span className="status-dot amber" />
                          {unresolved} to review
                        </Badge>
                      ) : c.quotations.length ? (
                        <Badge tone="teal">
                          <Check size={12} />
                          Ready to compare
                        </Badge>
                      ) : (
                        <Badge>Add quotations</Badge>
                      )}
                    </div>
                    <time className="updated-date" dateTime={c.updatedAt}>
                      {new Date(c.updatedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })}
                    </time>
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        aria-label={`Actions for ${c.name}`}
                        aria-expanded={menu === c.id}
                        onClick={() => setMenu(menu === c.id ? null : c.id)}
                      >
                        <MoreHorizontal size={19} />
                      </button>
                      {menu === c.id && (
                        <div className="dropdown">
                          <button
                            onClick={() => {
                              setMenu(null);
                              onRename(c);
                            }}
                          >
                            <Pencil size={14} />
                            Rename
                          </button>
                          <button
                            className="danger-text"
                            onClick={() => {
                              setMenu(null);
                              onDelete(c);
                            }}
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      )}
                      <Link
                        className="icon-button"
                        aria-label={`Open ${c.name}`}
                        href={`/comparisons/${c.id}/compare`}
                      >
                        <ChevronRight size={17} />
                      </Link>
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <EmptyState
            title={
              query
                ? "No matching comparisons"
                : "Your next decision starts here"
            }
            description={
              query
                ? "Try another name or clear the search."
                : "Create a comparison and add quotations from your suppliers."
            }
            action={
              <button className="button primary" onClick={onCreate}>
                <Plus size={16} />
                New comparison
              </button>
            }
          />
        )}
      </section>
      <div className="workspace-footnote">
        <Check size={15} />
        <p>
          Supplier-stated values stay intact. Corrections, assumptions and
          unresolved questions travel with your report.
        </p>
        <ArrowUpRight size={15} />
      </div>
    </>
  );
}
