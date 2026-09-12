"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronRight,
  ClipboardCheck,
  ShieldCheck,
  X,
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
  const searchRef = useRef<HTMLInputElement>(null);
  const needsReview = (c: Comparison) => c.quotations.some(q => q.issues.some(i => !i.resolved) || ["partial", "failed", "cancelled", "waiting_quota"].includes(q.status)) || c.groups.some(g => g.status === "proposed" || g.status === "stale") || (c.quotations.length > 1 && !c.groups.length);
  const reviewCount = comparisons.filter(needsReview).length;
  const quotations = comparisons.reduce((count, c) => count + c.quotations.length, 0);
  const visible = useMemo(() => comparisons.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) && (filter !== "review" || needsReview(c))), [comparisons, query, filter]);
  const featured = [...comparisons].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).find(c => !c.isDemo && c.quotations.length) ?? comparisons.find(c => c.id === "demo-studio") ?? comparisons.find(c => c.quotations.length);
  const featuredReview = featured?.quotations.find(q => q.issues.some(i => !i.resolved) || q.status === "partial");
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
      if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey) && !event.altKey && !(event.target as HTMLElement).closest("input, textarea, select, [contenteditable], [role=dialog]")) { event.preventDefault(); searchRef.current?.focus(); }
    };
    const outside = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest(".row-actions")) setMenu(null); };
    document.addEventListener("keydown", key); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); };
  }, []);
  return (
    <div className="workspace-v2">
      <div className="workspace-heading">
        <div><h1>Your quotation workspace</h1><p>Compare supplier offers. Keep the evidence behind every decision.</p></div>
        <button className="button primary" onClick={onCreate}><Plus size={17} />New comparison</button>
      </div>
      <section className="workspace-welcome" aria-label="Continue your work">
        <div className="welcome-copy">
          <span className="welcome-context"><span className="status-dot" />{featured?.isDemo ? "A practical place to start" : featured ? "Continue your latest comparison" : "Start a comparison"}</span>
          <h2>{featured?.name ?? "Bring the whole picture together."}</h2>
          <p>{featured?.description || "Add your quotations, review what matters and build a comparison you can stand behind."}</p>
          <div className="welcome-actions">
            {featured ? <><Link className="button primary" href={`/comparisons/${featured.id}/${featuredReview ? `review?q=${encodeURIComponent(featuredReview.id)}` : "compare"}`}>
              {featuredReview ? "Continue review" : "Open comparison"}<ArrowRight size={16} />
            </Link><span className="welcome-detail">{featured.quotations.length} supplier quotations{featured.isDemo ? " / Fictional sample" : ""}</span></> : <button className="button primary" onClick={onCreate}>Create your first comparison<ArrowRight size={16} /></button>}
          </div>
        </div>
        <div className="welcome-art" aria-hidden="true"><Image src="/images/quotation-still-life-v1.webp" alt="" fill sizes="(max-width: 760px) 1px, 420px" loading="eager" unoptimized /></div>
      </section>
      <div className="workspace-pulse" aria-label="Workspace summary">
        <div><FolderOpen size={18} /><strong>{comparisons.length}</strong><span>Comparisons</span></div>
        <div><FileText size={18} /><strong>{quotations}</strong><span>Quotations</span></div>
        <button onClick={() => { setFilter(filter === "review" ? "all" : "review"); setQuery(""); }} aria-pressed={filter === "review"}><ClipboardCheck size={18} /><strong>{reviewCount}</strong><span>{reviewCount === 1 ? "Comparison needs review" : "Comparisons need review"}</span><ChevronRight size={14} /></button>
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
              ref={searchRef}
              aria-keyshortcuts="Control+k Meta+k"
              aria-label="Search comparisons"
              placeholder="Search comparisons"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? <button className="search-clear" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label="Clear search"><X size={14} /></button> : <kbd>Ctrl K</kbd>}
          </div>
        </div>
        <div className="list-controls">
          <div className="segmented">
            <button
              className={filter === "all" ? "active" : ""}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All comparisons
            </button>
            <button
              className={filter === "review" ? "active" : ""}
              aria-pressed={filter === "review"}
              onClick={() => setFilter("review")}
            >
              Needs review{reviewCount > 0 && <span>{reviewCount}</span>}
            </button>
          </div>
          <span className="muted small">Most recently updated</span>
        </div>
        {visible.length ? (
          <div className="comparison-list">
            <div className="comparison-list-head">
              <span>Comparison</span>
              <span>Suppliers</span>
              <span>Next step</span>
              <span>Updated</span>
              <span />
            </div>
            {[...visible]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((c) => {
                const unresolved = c.quotations
                  .flatMap((q) => q.issues)
                  .filter((i) => !i.resolved).length;
                const pendingMatches = c.groups.filter(g => g.status === "proposed" || g.status === "stale").length;
                const processing = c.quotations.some(q => ["queued", "validating", "parsing", "extracting", "reconciling"].includes(q.status));
                const incomplete = c.quotations.some(q => ["partial", "failed", "cancelled", "waiting_quota"].includes(q.status));
                const needsRetry = c.quotations.some(q => ["failed", "cancelled", "waiting_quota"].includes(q.status));
                const nextRoute = processing || needsRetry || !c.quotations.length ? "upload" : unresolved || incomplete ? "review" : c.quotations.length < 2 ? "upload" : pendingMatches || !c.groups.length ? "matching" : "compare";
                const reviewQuotation = c.quotations.find(q => q.issues.some(i => !i.resolved) || q.status === "partial");
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
                    <Link className="next-step-link" href={`/comparisons/${c.id}/${nextRoute}${nextRoute === "review" && reviewQuotation ? `?q=${encodeURIComponent(reviewQuotation.id)}` : ""}`}>
                      {processing ? <Badge tone="blue">Processing quotations</Badge> : unresolved || incomplete ? <Badge tone="amber"><span className="status-dot amber" />{unresolved ? `${unresolved} open ${unresolved === 1 ? "issue" : "issues"}` : "Check extraction"}</Badge> : pendingMatches ? <Badge tone="amber">{pendingMatches} {pendingMatches === 1 ? "match" : "matches"} to review</Badge> : c.quotations.length < 2 ? <Badge>{c.quotations.length ? "Add another supplier" : "Add quotations"}</Badge> : c.groups.length ? <Badge tone="teal"><Check size={12} />Review complete</Badge> : <Badge>Match items</Badge>}
                      <span className="sr-only"> — Next step for {c.name}</span>
                    </Link>
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
                : filter === "review" ? "Your review queue is clear" : "Your next decision starts here"
            }
            description={
              query
                ? "Try another name or clear the search."
                : filter === "review" ? "No comparisons are waiting for review. You can still revisit their evidence and assumptions." : "Create a comparison and add quotations from your suppliers."
            }
            action={
              query || filter === "review" ? <button className="button secondary" onClick={() => { setQuery(""); setFilter("all"); }}>Show all comparisons</button> : <button className="button primary" onClick={onCreate}><Plus size={16} />New comparison</button>
            }
          />
        )}
      </section>
      <div className="workspace-assurance"><ShieldCheck size={18} /><p>{capabilities.canPersist ? "Private originals stay in your workspace. " : "Fictional quotations. Your sample edits stay in this browser. "}Sources, corrections and open questions travel with every report.</p><Link href="/reliability">See reliability evidence<ArrowRight size={14} /></Link></div>
    </div>
  );
}
