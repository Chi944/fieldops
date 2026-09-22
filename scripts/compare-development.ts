import { readFile, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeImmutableJson, type evaluateDevelopment } from "./evaluate-development";
import { EXTRACTION_METRICS, type Fraction } from "../eval/metrics";
import { assertComparableModelConfigurations, MODEL_STUDY_METRIC_VERSION } from "../eval/model-study-control";

type Report = Awaited<ReturnType<typeof evaluateDevelopment>>;
const format = (metric: Fraction) => metric.value === null ? `unavailable (${metric.numerator}/${metric.denominator})` : `${(metric.value * 100).toFixed(1)}% (${metric.numerator}/${metric.denominator})`;
export function compareDevelopmentReports(before: Report, after: Report, baselineSha256?: string) {
  const referenced = after.baselineReference;
  const namesAgree = before.name === after.name || Boolean(referenced && referenced.name === before.name && referenced.sha256 === baselineSha256 && referenced.configurationHash === before.configuration.sha256 && referenced.measuredAt === before.measuredAt && referenced.model === before.configuration.model && referenced.model === after.configuration.model);
  if (!namesAgree || before.phase !== "before" || after.phase !== "after" || before.mode !== "live" || after.mode !== "live" || JSON.stringify(before.pair) !== JSON.stringify(after.pair)) throw new Error("Comparison requires matching immutable live before/after reports with the same cohort and limits.");
  if (!before.configurationStableDuringRun || !after.configurationStableDuringRun) throw new Error("A phase changed configuration during execution; a valid paired comparison cannot be generated.");
  if (before.dataset.split !== "dev" || after.dataset.split !== "dev" || before.dataset.heldoutModelCalls || after.dataset.heldoutModelCalls || !before.fields || !after.fields) throw new Error("Only development extraction measurements may be compared.");
  const modelStudy = before.pair.comparisonKind === "model";
  if (modelStudy) {
    if (referenced || before.pair.metricVersion !== MODEL_STUDY_METRIC_VERSION || after.pair.comparisonKind !== "model") throw new Error("Model comparison requires a new paired study without a referenced baseline.");
    assertComparableModelConfigurations(before.configuration, after.configuration);
  } else if (before.configuration.model !== after.configuration.model) throw new Error("Changing models requires explicit model comparison mode.");
  const fileHashes = new Map(before.configuration.files.map(file => [file.file, file.sha256]));
  return {
    version: modelStudy ? 2 : 1, name: after.name, comparedAt: new Date().toISOString(), pair: before.pair, ...(referenced ? { baselineReference: referenced } : {}),
    configurations: { before: before.configuration.sha256, after: after.configuration.sha256, beforeModel: before.configuration.model, afterModel: after.configuration.model, beforeChunkFailurePolicy: before.configuration.chunkFailurePolicy ?? "reject_document", afterChunkFailurePolicy: after.configuration.chunkFailurePolicy ?? "reject_document", beforeExtractionTransport: before.configuration.extractionTransport ?? "legacy_v5", afterExtractionTransport: after.configuration.extractionTransport ?? "legacy_v5", changedFiles: after.configuration.files.filter(file => fileHashes.get(file.file) !== file.sha256).map(file => file.file) },
    readiness: { before: before.readiness ?? null, after: after.readiness ?? null, scope: "New selected-annotation gate is unavailable for historical reports; never backfill an unmeasured pass." },
    completion: { before: before.completion, after: after.completion, requestedDocuments: before.dataset.requestedDocuments },
    metrics: EXTRACTION_METRICS.map(key => ({ key, before: before.fields![key], after: after.fields![key], percentagePointChange: before.fields![key].value !== null && after.fields![key].value !== null ? (after.fields![key].value! - before.fields![key].value!) * 100 : null })),
    documents: before.measurements.map(measurement => ({ id: measurement.id, before: measurement, after: after.measurements.find(candidate => candidate.id === measurement.id) ?? null })),
    observedUsage: { before: before.observedUsage, after: after.observedUsage },
    missingStateAudit: { before: before.missingStateAudit ?? null, after: after.missingStateAudit ?? null },
    elapsedMs: { before: before.elapsedMs, after: after.elapsedMs },
    limitations: ["Adaptive development comparison of the same small synthetic cohort; no held-out measurement or causal guarantee.", ...(modelStudy ? ["Pipeline, runtime, originals, annotations and phase budgets are identical. Model and explicitly recorded reasoning profile differ. Sequential phases may occur on separate UTC days; provider conditions are not controlled.", "This version gives rejected and unattempted documents zero recall credit in the full fixed cohort. It does not rewrite or directly equate historical metrics that omitted unattempted recall denominators."] : ["Inspect all changed configuration files, including any harness changes, before attributing a difference to the model implementation."]), "Document acceptance, partial output and correctness are separate. Rejected attempts retain zero recall credit; unattempted documents remain explicit.", "Precision/source denominators depend on returned output; unavailable denominators have no numeric improvement score.", "Elapsed time includes deliberate quota pacing and cannot establish production latency. Usage totals exclude unavailable response usage; no provider invoice is measured.", "The separate interrupted harness preflight is excluded from both phases and their metrics."],
  };
}
export async function writeDevelopmentComparison(name: string, root = process.cwd()) {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(name)) throw new Error("Use an existing lowercase development experiment name.");
  const directory = path.join(root, "eval/results/development", name);
  const after = JSON.parse(await readFile(path.join(directory, "live-after.json"), "utf8")) as Report;
  const baselineName = after.baselineReference?.name ?? name;
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(baselineName)) throw new Error("Invalid baseline experiment name.");
  const baselineRelativePath = `eval/results/development/${baselineName}/live-before.json`;
  const baselinePath = path.join(root, baselineRelativePath);
  if (await realpath(baselinePath) !== baselinePath || (after.baselineReference && after.baselineReference.report !== baselineRelativePath)) throw new Error("Invalid or redirected baseline report path.");
  const baselineBytes = await readFile(baselinePath), baselineSha256 = createHash("sha256").update(baselineBytes).digest("hex");
  const before = JSON.parse(baselineBytes.toString("utf8")) as Report;
  if (after.baselineReference) {
    const reference = JSON.parse(await readFile(path.join(directory, "baseline-reference.json"), "utf8"));
    if (JSON.stringify(reference) !== JSON.stringify(after.baselineReference) || reference.sha256 !== baselineSha256) throw new Error("The original baseline or its immutable reference changed.");
  }
  const report = compareDevelopmentReports(before, after, baselineSha256);
  if (report.name !== name) throw new Error("Report name does not match its directory.");
  await writeImmutableJson(path.join(directory, "comparison.json"), report);
  const markdown = `# Complete quotation before/after comparison\n\n${name}: ${before.dataset.requestedDocuments} synthetic development quotations, ${before.dataset.logicalItems} line items and ${before.dataset.annotatedFields} field assertions. Held-out calls: zero.\n\n| Document | Before | After |\n|---|---|---|\n${report.documents.map(document => `| ${document.id} | ${document.before.status}${document.before.errorCode ? `: ${document.before.errorCode}` : ""} | ${document.after?.status ?? "missing"}${document.after?.errorCode ? `: ${document.after.errorCode}` : ""} |`).join("\n")}\n\n| Metric | Before | After | Change (percentage points) |\n|---|---|---|---:|\n${report.metrics.map(metric => `| ${metric.key} | ${format(metric.before)} | ${format(metric.after)} | ${metric.percentagePointChange === null ? "unavailable" : metric.percentagePointChange.toFixed(1)} |`).join("\n")}\n\nComplete documents: ${before.completion.completeDocuments}/${before.dataset.requestedDocuments} before, ${after.completion.completeDocuments}/${after.dataset.requestedDocuments} after. Partial documents: ${before.completion.partialDocuments} / ${after.completion.partialDocuments}; unattempted: ${before.completion.unattemptedDocuments} / ${after.completion.unattemptedDocuments}.\n\n| Returned usage | Before | After |\n|---|---:|---:|\n| Responses | ${before.observedUsage.returnedResponses} | ${after.observedUsage.returnedResponses} |\n| Responses without usage | ${before.observedUsage.responsesWithoutUsage} | ${after.observedUsage.responsesWithoutUsage} |\n| Known input tokens | ${before.observedUsage.inputTokens} | ${after.observedUsage.inputTokens} |\n| Known output tokens | ${before.observedUsage.outputTokens} | ${after.observedUsage.outputTokens} |\n| Phase elapsed ms, including pacing | ${Math.round(before.elapsedMs)} | ${Math.round(after.elapsedMs)} |\n\nBefore configuration: \`${before.configuration.sha256}\`. After: \`${after.configuration.sha256}\`. Changed files: ${report.configurations.changedFiles.map(file => `\`${file}\``).join(", ") || "none"}.\n\n${report.limitations.map(limitation => `- ${limitation}`).join("\n")}\n\n[Before](live-before.json) · [After](live-after.json) · [Comparison JSON](comparison.json).\n`;
  const policyNote = `\nChunk failure policy: before \`${report.configurations.beforeChunkFailurePolicy}\`, after \`${report.configurations.afterChunkFailurePolicy}\`. Any gain from retaining validated chunks is partial availability, not complete interpretation or better model generation. Matching missing states without source evidence: before ${report.missingStateAudit.before?.unsourcedMatchingStates ?? "not separately reported"}, after ${report.missingStateAudit.after?.unsourcedMatchingStates ?? "not separately reported"}. Unsourced defaults are not verified absence; historical scoring remains unchanged.\n`;
  await writeFile(path.join(directory, "comparison.md"), (after.baselineReference ? markdown.replace("[Before](live-before.json)", `[Original before: ${baselineName}](../${baselineName}/live-before.json)`) + `\nThe baseline was originally measured ${before.measuredAt} and referenced by SHA-256 \`${baselineSha256}\`; no baseline rerun or copy was made. Earlier candidates retain their original reports.\n` : markdown) + policyNote, { flag: "wx" });
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--name") { console.error("Use --name <existing-development-experiment>."); process.exitCode = 1; }
  else writeDevelopmentComparison(args[1]).then(() => console.log("Immutable development comparison written.")).catch(error => { console.error(error instanceof Error ? error.message : "Comparison failed."); process.exitCode = 1; });
}
