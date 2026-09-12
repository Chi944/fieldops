import type { ProcessingRun } from "@/lib/domain/types";

type PollingRun = Pick<ProcessingRun, "stage"> & { retryAfter?: string };
const activeStages = new Set(["queued", "validating", "parsing", "extracting", "reconciling"]);

function nextDelay(runs: readonly PollingRun[]): number | null {
  if (runs.some(run => activeStages.has(run.stage))) return 3000;
  const deadlines = runs.filter(run => run.stage === "waiting_quota" && run.retryAfter)
    .map(run => Date.parse(run.retryAfter!)).filter(Number.isFinite);
  // A quota wait without a deadline needs explicit retry, not idle polling.
  return deadlines.length ? Math.max(3000, Math.min(...deadlines) - Date.now() + 1000) : null;
}

/** Visible active work polls serially; completed comparisons refresh only on user return/actions. */
export function createComparisonPoller(options: {
  refresh: () => Promise<readonly PollingRun[]>;
  isVisible: () => boolean;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false, inFlight = false, failures = 0;
  let observation = 0;
  let runs: readonly PollingRun[] = [];
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    clear();
    if (stopped || inFlight || !options.isVisible()) return;
    // Stop repeated outage traffic; focus and explicit actions can try again.
    const delay = failures ? failures < 3 ? 10000 * failures : null : nextDelay(runs);
    if (delay !== null) timer = setTimeout(() => { void refresh(); }, delay);
  };
  const observe = (next: readonly PollingRun[]) => { observation++; runs = next; failures = 0; schedule(); };
  const refresh = async () => {
    if (stopped || inFlight || !options.isVisible()) return;
    clear(); inFlight = true;
    const startedAtObservation = observation;
    // A mutation's explicit refresh can observe newer work while this read is pending.
    // Neither its stale result nor its error may replace that scheduling decision.
    try { const next = await options.refresh(); if (!stopped && observation === startedAtObservation) { runs = next; failures = 0; } }
    catch { if (observation === startedAtObservation) failures++; }
    finally { inFlight = false; schedule(); }
  };
  return {
    observe,
    refresh,
    visibilityChanged() { clear(); if (options.isVisible()) { failures = 0; void refresh(); } },
    stop() { stopped = true; clear(); },
  };
}
