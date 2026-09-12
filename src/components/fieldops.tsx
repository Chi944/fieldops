"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Columns3,
  FileDown,
  Files,
  FolderOpen,
  LayoutDashboard,
  Loader2,
  Menu,
  Plus,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import { demoComparisons } from "@/lib/demo";
import type { Comparison, FieldValue, ProcessingRun } from "@/lib/domain/types";
import { applyCorrection, StaleRevisionError } from "@/lib/domain/corrections";
import { AppContext, api, Capabilities, revisionOf } from "./context";
import { Badge, Brand, EmptyState, Modal } from "./ui";
import { WorkspaceScreen } from "./workspace";
import { UploadScreen } from "./upload";
import { ReviewScreen } from "./review";
import { MatchingScreen } from "./matching";
import { ComparisonScreen, ReportScreen } from "./comparison";

const steps = [
  { id: "upload", name: "Quotations", icon: UploadCloud },
  { id: "review", name: "Extraction review", icon: ClipboardCheck },
  { id: "matching", name: "Item matching", icon: Files },
  { id: "compare", name: "Comparison", icon: Columns3 },
  { id: "export", name: "Export report", icon: FileDown },
];
const initialCapabilities: Capabilities = {
  mode: "demo",
  authenticated: false,
  canPersist: false,
  canUpload: false,
  canExtract: false,
  reasons: [],
};
export function FieldOps({
  initialReviewQuotationId,
}: {
  initialReviewQuotationId?: string;
}) {
  const [comparisons, setComparisonState] =
    useState<Comparison[]>(demoComparisons);
  const latestComparisons = useRef(comparisons);
  const setComparisons = useCallback(
    (next: Comparison[] | ((all: Comparison[]) => Comparison[])) => {
      const resolved =
        typeof next === "function" ? next(latestComparisons.current) : next;
      latestComparisons.current = resolved;
      setComparisonState(resolved);
    },
    [],
  );
  const [initializing, setInitializing] = useState(true);
  const [capabilities, setCapabilities] =
    useState<Capabilities>(initialCapabilities);
  const [overviewScope, setOverviewScope] = useState<"personal" | "samples">("personal");
  const [creationScope, setCreationScope] = useState<"personal" | "samples">("samples");
  const [workspaceDialog, setWorkspaceDialog] = useState(false);
  const [runs, setRuns] = useState<ProcessingRun[]>([]);
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [newDialog, setNewDialog] = useState(false),
    [help, setHelp] = useState(false),
    [mobileNav, setMobileNav] = useState(false);
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [creating, setCreating] = useState(false);
  const [rename, setRename] = useState<Comparison | null>(null),
    [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Comparison | null>(null);
  const loaded = useRef(false),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pathname = usePathname(),
    router = useRouter();
  const workflowNav = useRef<HTMLElement>(null);
  const path = pathname.split("/").filter(Boolean),
    comparisonId = path[0] === "comparisons" ? path[1] : null;
  const current = comparisons.find((c) => c.id === comparisonId),
    view = path[2] ?? "compare";
  useEffect(() => {
    const nav = workflowNav.current;
    if (!nav) return;
    const revealActiveStep = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="step"]');
      if (!active || nav.scrollWidth <= nav.clientWidth) return;
      const viewport = nav.getBoundingClientRect(), item = active.getBoundingClientRect();
      const offset = item.left < viewport.left ? item.left - viewport.left : item.right > viewport.right ? item.right - viewport.right : 0;
      // Move only the horizontal strip. scrollIntoView would also move the page.
      if (offset) nav.scrollTo({ left: nav.scrollLeft + offset, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    };
    const frame = requestAnimationFrame(revealActiveStep);
    const resize = new ResizeObserver(revealActiveStep);
    resize.observe(nav);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); };
  }, [pathname, current?.id]);
  const workspaceScope = current ? current.isDemo ? "samples" : "personal" : capabilities.canPersist ? overviewScope : "samples";
  const workspaceComparisons = useMemo(() => comparisons.filter(comparison => comparison.isDemo === (workspaceScope === "samples")), [comparisons, workspaceScope]);
  const switchWorkspace = useCallback((scope: "personal" | "samples") => {
    if (scope === "personal" && !capabilities.canPersist) { setWorkspaceDialog(true); return; }
    setOverviewScope(scope); setWorkspaceDialog(false); setMobileNav(false); router.push("/");
  }, [capabilities.canPersist, router]);
  const toast = useCallback((message: string, error = false) => {
    setNotice({ message, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setNotice(null), error ? 9000 : 4500);
  }, []);
  const replaceComparison = useCallback(
    (c: Comparison) => {
      setComparisons((all) =>
        all.some((i) => i.id === c.id)
          ? all.map((i) => (i.id === c.id && c.revision >= i.revision ? c : i))
          : [c, ...all],
      );
    },
    [setComparisons],
  );
  const refresh = useCallback(
    async (id: string) => {
      const result = await api<{
        comparison: Comparison;
        runs: ProcessingRun[];
      }>(`/api/comparisons/${id}`);
      replaceComparison(result.comparison);
      setRuns(result.runs ?? []);
    },
    [replaceComparison],
  );
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const saved = localStorage.getItem("fieldops-demo-v1");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (
            Array.isArray(parsed) &&
            parsed.every(
              (c) =>
                c.isDemo &&
                Array.isArray(c.quotations) &&
                Array.isArray(c.groups) &&
                Array.isArray(c.corrections),
            )
          )
            setComparisons(parsed);
        }
      } catch {
        /* Recover by using the bundled sample. */
      }
      loaded.current = true;
    });
    api<Capabilities>("/api/status")
      .then(async (status) => {
        setCapabilities(status);
        if (status.canPersist) {
          const result = await api<{ comparisons: Comparison[] }>(
            "/api/comparisons",
          );
          setComparisons((all) => [
            ...result.comparisons,
            ...all.filter((c) => c.isDemo),
          ]);
        }
      })
      .catch(() =>
        setCapabilities({
          ...initialCapabilities,
          reasons: [
            "Live workspace is unavailable. The sample workspace remains available.",
          ],
        }),
      )
      .finally(() => setInitializing(false));
  }, [setComparisons]);
  useEffect(() => {
    if (loaded.current)
      try {
        localStorage.setItem(
          "fieldops-demo-v1",
          JSON.stringify(comparisons.filter((c) => c.isDemo)),
        );
      } catch {
        queueMicrotask(() =>
          toast(
            "Browser storage is full or unavailable. Export your work before closing this tab.",
            true,
          ),
        );
      }
  }, [comparisons, toast]);
  const persistentId =
    current && !current.isDemo && capabilities.canPersist ? current.id : null;
  useEffect(() => {
    if (!persistentId) return;
    const id = persistentId;
    let live = true;
    const tick = async () => {
      try {
        const result = await api<{
          comparison: Comparison;
          runs: ProcessingRun[];
        }>(`/api/comparisons/${id}`);
        if (live) {
          replaceComparison(result.comparison);
          setRuns(result.runs ?? []);
        }
      } catch {
        /* Keep the last successful state; user-triggered actions show errors. */
      }
    };
    void tick();
    const timer = setInterval(tick, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [persistentId, replaceComparison]);
  const save = useCallback(
    async (next: Comparison) => {
      if (next.isDemo) {
        if (
          latestComparisons.current.find((c) => c.id === next.id)?.revision !==
          next.revision
        )
          throw new StaleRevisionError();
        replaceComparison(revisionOf(next));
        return;
      }
      const response = await api<{ comparison: Comparison }>(
        `/api/comparisons/${next.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            baseRevision: next.revision,
            name: next.name,
            description: next.description,
            groups: next.groups,
            exchangeRates: next.exchangeRates,
            preferences: next.preferences,
          }),
        },
      );
      replaceComparison(response.comparison);
    },
    [replaceComparison],
  );
  const correct = useCallback(
    async (
      c: Comparison,
      quotationId: string,
      fieldPath: string,
      after: FieldValue,
      reason: string,
    ) => {
      if (
        c.isDemo &&
        latestComparisons.current.find((x) => x.id === c.id)?.revision !==
          c.revision
      )
        throw new StaleRevisionError();
      if (c.isDemo)
        replaceComparison(
          applyCorrection(c, {
            quotationId,
            path: fieldPath,
            value: after.value,
            state: after.state,
            reason,
            author: "Demo reviewer",
            baseVersion: c.revision,
          }),
        );
      else {
        const result = await api<{ comparison: Comparison }>(
          `/api/comparisons/${c.id}/corrections`,
          {
            method: "POST",
            body: JSON.stringify({
              baseRevision: c.revision,
              quotationId,
              path: fieldPath,
              after,
              reason,
            }),
          },
        );
        replaceComparison(result.comparison);
      }
      toast("Correction saved. The original interpretation is preserved.");
    },
    [replaceComparison, toast],
  );
  const create = useCallback(
    async (comparisonName: string, desc: string) => {
      let c: Comparison;
      if (creationScope === "personal" && !capabilities.canPersist) throw new Error("Your personal workspace is unavailable. Open FieldOps locally before adding private quotations.");
      if (creationScope === "personal")
        c = (
          await api<{ comparison: Comparison }>("/api/comparisons", {
            method: "POST",
            body: JSON.stringify({ name: comparisonName, description: desc }),
          })
        ).comparison;
      else {
        const now = new Date().toISOString();
        c = {
          id: `demo-${crypto.randomUUID()}`,
          workspaceId: "demo",
          name: comparisonName,
          description: desc,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          isDemo: true,
          quotations: [],
          groups: [],
          corrections: [],
          exchangeRates: [],
          preferences: { priority: "cost", notes: "" },
        };
      }
      replaceComparison(c);
      router.push(`/comparisons/${c.id}/upload`);
      toast(
        creationScope === "personal"
          ? "Comparison created."
          : "Demo comparison created. Add saved samples to explore the workflow.",
      );
    },
    [capabilities.canPersist, creationScope, replaceComparison, router, toast],
  );
  const remove = useCallback(
    async (c: Comparison) => {
      if (!c.isDemo)
        await api(`/api/comparisons/${c.id}`, { method: "DELETE" });
      setComparisons((all) => all.filter((x) => x.id !== c.id));
      if (current?.id === c.id) router.push("/");
      toast("Comparison deleted.");
    },
    [current?.id, router, toast, setComparisons],
  );
  const reset = useCallback(() => {
    setComparisons((all) => [
      ...all.filter((c) => !c.isDemo),
      ...demoComparisons(),
    ]);
    toast("Sample workspace reset. Live comparisons are unchanged.");
  }, [toast, setComparisons]);
  const value = useMemo(
    () => ({
      comparisons: workspaceComparisons,
      workspaceScope,
      switchWorkspace,
      capabilities,
      runs,
      toast,
      save,
      create,
      remove,
      reset,
      correct,
      refresh,
    }),
    [
      workspaceComparisons,
      workspaceScope,
      switchWorkspace,
      capabilities,
      runs,
      toast,
      save,
      create,
      remove,
      reset,
      correct,
      refresh,
    ],
  );
  const issues =
    current?.quotations.flatMap((q) => q.issues).filter((i) => !i.resolved)
      .length ?? 0;
  const openCreate = () => {
    if (initializing) { toast("Opening your workspace. Please wait a moment."); return; }
    setCreationScope(workspaceScope);
    setName("");
    setDescription("");
    setNewDialog(true);
    setMobileNav(false);
  };
  return (
    <AppContext.Provider value={value}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="application">
        <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
          <Link href="/" className="brand-link" aria-label="FieldOps workspace">
            <Brand />
          </Link>
          <button className="workspace-switch" onClick={() => setWorkspaceDialog(true)} aria-label="Choose workspace">
            <span className="workspace-avatar">F</span>
            <span>
              <strong>
                {workspaceScope === "samples" ? "Sample workspace" : capabilities.mode === "local"
                  ? "Local workspace"
                  : "FieldOps workspace"}
              </strong>
              <small>
                {workspaceScope === "personal" ? capabilities.mode === "local" ? "Saved on this computer" : "Private account storage" : "Fictional samples · browser edits"}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
          <button
            className="button primary sidebar-create"
            onClick={openCreate}
            disabled={initializing}
          >
            <Plus size={17} />
            New comparison
          </button>
          <nav aria-label="Main navigation">
            <Link
              href="/"
              className={`nav-item ${!comparisonId ? "active" : ""}`}
              onClick={() => setMobileNav(false)}
            >
              <LayoutDashboard size={18} />
              Overview
            </Link>
            <span className="nav-section-title">
              {workspaceScope === "personal" ? "Your comparisons" : "Sample comparisons"} <span>{workspaceComparisons.length}</span>
            </span>
            {workspaceComparisons.slice(0, 6).map((c) => (
              <Link
                key={c.id}
                href={`/comparisons/${c.id}/compare`}
                className={`nav-item comparison-nav ${current?.id === c.id ? "active" : ""}`}
                onClick={() => setMobileNav(false)}
              >
                <FolderOpen size={16} />
                <span>{c.name}</span>
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="evidence-promise">
              <span>
                <ShieldCheck size={19} />
              </span>
              <strong>Every number, a source.</strong>
              <p>Clear comparisons you can stand behind.</p>
            </div>
            <button className="nav-item" onClick={() => setHelp(true)}>
              <CircleHelp size={17} />
              How FieldOps works
              <ArrowUpRight size={13} />
            </button>
            <button className="nav-item" onClick={() => switchWorkspace(workspaceScope === "personal" ? "samples" : "personal")}>
              <FolderOpen size={16} />
              {workspaceScope === "personal" ? "Explore sample workspace" : "Use my own quotations"}
            </button>
            {workspaceScope === "samples" && <button className="nav-item" onClick={reset}>
              <RotateCcw size={16} />
              Reset sample workspace
            </button>}
            <div className="profile">
              <span className="profile-avatar">
                {capabilities.mode === "local" ? "LC" : "FO"}
              </span>
              <span>
                <strong>
                  {capabilities.mode === "local"
                    ? "Local reviewer"
                    : "Guest reviewer"}
                </strong>
                <small>
                  {capabilities.canPersist
                    ? "Workspace access enabled"
                    : "Exploring the demo"}
                </small>
              </span>
            </div>
          </div>
        </aside>
        {mobileNav && (
          <button
            className="nav-scrim"
            onClick={() => setMobileNav(false)}
            aria-label="Close navigation"
          />
        )}
        <div className="main-area">
          <header className="topbar">
            <div className="breadcrumbs">
              <button
                className="mobile-menu icon-button"
                onClick={() => setMobileNav(!mobileNav)}
                aria-label="Open navigation"
              >
                <Menu size={20} />
              </button>
              <Link href="/">Workspace</Link>
              {current && (
                <>
                  <ChevronRight size={13} />
                  <span>{current.name}</span>
                </>
              )}
            </div>
            <div className="topbar-actions">
              {capabilities.authenticated && capabilities.mode === "cloud" && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await api("/auth/logout", { method: "POST" });
                      setComparisons((all) => all.filter((c) => c.isDemo));
                      setCapabilities(initialCapabilities);
                      router.push("/");
                      router.refresh();
                    } catch (error) {
                      toast((error as Error).message, true);
                    }
                  }}
                >
                  Sign out
                </button>
              )}
              <Badge
                tone={
                  workspaceScope === "samples" ? "amber" : "teal"
                }
              >
                {workspaceScope === "samples"
                  ? "Sample workspace"
                  : capabilities.mode === "local"
                    ? "Local workspace"
                    : "Private workspace"}
              </Badge>
              {!capabilities.authenticated && capabilities.mode === "cloud" && (
                <Link
                  className="text-button"
                  href="/auth/login"
                  prefetch={false}
                >
                  Sign in <ArrowUpRight size={14} />
                </Link>
              )}
              <button
                className="icon-button"
                aria-label="About this workspace"
                onClick={() => setHelp(true)}
              >
                <CircleHelp size={18} />
              </button>
            </div>
          </header>
          <main
            id="main"
            className={
              view === "export" && current
                ? "main-content report-page"
                : view === "compare" && current ? "main-content comparison-page" : "main-content"
            }
          >
            {!comparisonId && initializing ? <EmptyState title="Opening your workspace" description="Checking personal storage and loading saved comparisons." /> : !comparisonId ? (
              <WorkspaceScreen
                onCreate={openCreate}
                onRename={(c) => {
                  setRename(c);
                  setRenameValue(c.name);
                }}
                onDelete={setDeleteTarget}
              />
            ) : current ? (
              <>
                <div className="comparison-heading">
                  <div>
                    <Link className="back-link" href="/">
                      <ArrowLeft size={14} />
                      All comparisons
                    </Link>
                    <h1>
                      {current.name}
                      <button
                        className="title-edit icon-button"
                        aria-label="Rename comparison"
                        onClick={() => {
                          setRename(current);
                          setRenameValue(current.name);
                        }}
                      >
                        <ChevronDown size={18} />
                      </button>
                    </h1>
                    <p>
                      {current.description ||
                        "Review the evidence. Compare like for like. Choose with clarity."}
                    </p>
                  </div>
                  <Link
                    className="button primary"
                    href={`/comparisons/${current.id}/export`}
                  >
                    <FileDown size={16} />
                    Export comparison
                  </Link>
                </div>
                {current.isDemo && (
                  <div className="demo-note">
                    <span className="status-dot amber" />
                    Demonstration · saved sample extractions. Your edits stay in
                    this browser.
                  </div>
                )}
                <nav className="step-nav" aria-label="Comparison workflow" ref={workflowNav}>
                  {steps.map((step, index) => (
                    <Link
                      key={step.id}
                      href={`/comparisons/${current.id}/${step.id}`}
                      className={view === step.id ? "active" : ""}
                      aria-current={view === step.id ? "step" : undefined}
                    >
                      <span className="step-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                      <step.icon size={17} />
                      {step.name}
                      {step.id === "review" && issues > 0 && <span className="step-count">{issues} {issues === 1 ? "issue" : "issues"}</span>}
                    </Link>
                  ))}
                </nav>
                {view === "upload" ? (
                  <UploadScreen comparison={current} />
                ) : view === "review" ? (
                  <ReviewScreen
                    key={`${current.id}:${initialReviewQuotationId ?? ""}`}
                    comparison={current}
                    initialQuotationId={initialReviewQuotationId}
                  />
                ) : view === "matching" ? (
                  <MatchingScreen comparison={current} />
                ) : view === "export" ? (
                  <ReportScreen key={current.id} comparison={current} />
                ) : (
                  <ComparisonScreen comparison={current} />
                )}
              </>
            ) : (
              <EmptyState
                title={
                  initializing
                    ? "Opening your workspace?"
                    : "Comparison not found"
                }
                description={
                  initializing
                    ? "Loading your saved comparison and review history."
                    : "It may have been deleted, or the private workspace may be unavailable."
                }
                action={
                  <Link className="button primary" href="/">
                    Return to workspace
                  </Link>
                }
              />
            )}
          </main>
          <footer className="app-footer">
            <Link href="/reliability" className="text-button">
              Reliability evidence
            </Link>
            <Brand small />
            <span>Built for decisions. Grounded in evidence.</span>
            <button onClick={() => setHelp(true)}>
              About this release <ArrowUpRight size={12} />
            </button>
          </footer>
        </div>
      </div>
      {notice && (
        <div
          className={`toast ${notice.error ? "error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? <X size={17} /> : <Check size={17} />}
          <span>{notice.message}</span>
          <button
            className="icon-button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      <Modal
        open={newDialog}
        onClose={() => setNewDialog(false)}
        title="Start a comparison"
        description="Give this decision a name. You can add quotations next."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setCreating(true);
            try {
              await create(name.trim(), description.trim());
              setNewDialog(false);
            } catch (error) {
              toast((error as Error).message, true);
            } finally {
              setCreating(false);
            }
          }}
        >
          <label className="form-label">
            Comparison name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="e.g. Office equipment & installation"
              required
            />
          </label>
          <label className="form-label">
            What are you buying? <span>Optional</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              placeholder="A little context for your comparison"
              rows={3}
            />
          </label>
          {creationScope === "samples" ? (
            <div className="notice-box">
              This creates a sample comparison in this browser. It accepts saved fictional samples only. Use your personal workspace for your own quotations.
            </div>
          ) : <div className="notice-box"><ShieldCheck size={17} /><span>{capabilities.mode === "local" ? "Your comparison and original files are saved on this computer and remain available after a restart." : "Your comparison and original files are saved privately in your account."} You can read sources and enter items without AI.</span></div>}
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setNewDialog(false)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={creating || !name.trim()}
            >
              {creating ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              Create comparison
            </button>
          </div>
        </form>
      </Modal>
      <Modal open={workspaceDialog} onClose={() => setWorkspaceDialog(false)} title="Choose a workspace" description="Your quotations and fictional examples stay separate.">
        <div className="workspace-choice-list">
          {capabilities.canPersist ? <button className="workspace-choice" onClick={() => switchWorkspace("personal")}>
            <ShieldCheck size={21} /><span><strong>{capabilities.mode === "local" ? "My local workspace" : "My private workspace"}</strong><small>{capabilities.mode === "local" ? "Original files, reviewed items and exports saved on this computer." : "Your original files and comparisons saved privately in your account."}</small></span><ChevronRight size={17} />
          </button> : <div className="personal-setup-panel"><h3>Use your own quotations locally</h3><p>The public demo cannot receive private files. In your FieldOps project, run:</p><code>npm run personal</code><p>Open the local address printed by the launcher. It stores your work on your computer; source reading and manual comparison need no AI key.</p><a className="text-button" href="https://github.com/Chi944/fieldops/blob/main/docs/personal-use.md" target="_blank" rel="noreferrer">Personal setup instructions <ArrowUpRight size={14} /></a></div>}
          <button className="workspace-choice" onClick={() => switchWorkspace("samples")}><Files size={21} /><span><strong>Fictional sample workspace</strong><small>Explore saved examples. Sample edits are stored only in this browser.</small></span><ChevronRight size={17} /></button>
        </div>
      </Modal>
      <Modal
        open={!!rename}
        onClose={() => setRename(null)}
        title="Rename comparison"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!rename || !renameValue.trim()) return;
            try {
              await save({ ...rename, name: renameValue.trim() });
              setRename(null);
              toast("Comparison renamed.");
            } catch (err) {
              toast((err as Error).message, true);
            }
          }}
        >
          <label className="form-label">
            Comparison name
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              required
              maxLength={120}
            />
          </label>
          <div className="modal-actions">
            <button className="button primary" type="submit">
              Save name
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete this comparison?"
        description={
          deleteTarget?.isDemo
            ? "This removes the comparison and its edits from this browser. You can restore the original samples with Reset sample workspace."
            : "This removes workspace access and deletes its quotations and derived data. This cannot be undone."
        }
      >
        <div className="modal-actions">
          <button
            className="button secondary"
            onClick={() => setDeleteTarget(null)}
          >
            Keep comparison
          </button>
          <button
            className="button danger"
            onClick={async () => {
              if (!deleteTarget) return;
              try {
                await remove(deleteTarget);
                setDeleteTarget(null);
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          >
            Delete comparison
          </button>
        </div>
      </Modal>
      <Modal
        open={help}
        onClose={() => setHelp(false)}
        title="A clearer way to compare"
        description="FieldOps brings supplier quotations into one evidence-linked workspace."
        wide
      >
        <div className="help-grid">
          <div>
            <h3>From quotation to decision</h3>
            <ol>
              <li>Add supplier quotations.</li>
              <li>Review extracted values beside their original evidence.</li>
              <li>Approve comparable items and flag alternatives.</li>
              <li>Set required quantities and compare explicit costs.</li>
              <li>Export a report with assumptions and unresolved issues.</li>
            </ol>
          </div>
          <div>
            <h3>This first release</h3>
            <p>
              Saved samples are self-authored and clearly labelled. Live
              processing supports text PDFs, legible English scans, PNG/JPEG,
              XLSX, CSV and pasted text within published limits.
            </p>
            <p>
              Unknown terms stay unknown. AI suggestions require review, and all
              price calculations use deterministic decimal arithmetic.
            </p>
            <Badge tone={capabilities.canExtract ? "teal" : "amber"}>
              {capabilities.canExtract
                ? "Live extraction configured"
                : "Live extraction unavailable"}
            </Badge>
            {capabilities.reasons.map((reason, i) => (
              <p className="small muted" key={i}>
                {reason}
              </p>
            ))}
          </div>
        </div>
      </Modal>
    </AppContext.Provider>
  );
}
