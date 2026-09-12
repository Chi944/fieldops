import Link from "next/link";
import result from "../../../eval/results/latest.json";
export const metadata = { title: "Reliability evidence — FieldOps" };
export default function ReliabilityPage() {
  return (
    <main className="reliability-page">
      <Link className="back-link" href="/">
        ← FieldOps workspace
      </Link>
      <span className="eyebrow">Measured, with the limits in view</span>
      <h1>
        A comparison is only useful
        <br />
        if you can trust its boundaries.
      </h1>
      <p className="reliability-intro">
        We test quotation parsing, conservative item matching and deterministic
        calculations separately. The figures below are measured on self-authored
        synthetic documents. The matching cards show a simple identifier/text
        baseline. Actual model results and failures are recorded separately in
        the downloadable report.
      </p>
      <div className="reliability-metrics">
        <article>
          <strong>{result.dataset.documents}</strong>
          <span>
            documents · {result.dataset.scenarios} unrelated buying scenarios
          </span>
        </article>
        <article>
          <strong>
            {result.matching.truePositive}/
            {result.matching.truePositive + result.matching.falsePositive}
          </strong>
          <span>correct baseline equivalence suggestions</span>
        </article>
        <article>
          <strong>
            {result.matching.truePositive}/
            {result.matching.truePositive + result.matching.falseNegative}
          </strong>
          <span>expected equivalent pairs found</span>
        </article>
      </div>
      <section>
        <h2>What was tested</h2>
        <p>
          This run contains {result.dataset.logicalItems} line items in the {result.split} split.
          The full benchmark spans 24 documents: text PDFs, printed scans,
          images, XLSX, CSV and pasted text. Four scenarios form the development
          set and four are held out. Separate robustness assertions cover
          duplicates, revisions, protected or malformed files, unreadable
          images, size limits and malicious document instructions.
        </p>
        <p>
          {result.parser.completeDocuments}/{result.parser.attemptedDocuments} attempted documents produced complete parser manifests in this run. That
          means the parser accounted for its pages or sheets; it does not
          establish complete or accurate AI extraction.
        </p>
      </section>
      <section>
        <h2>Where the baseline falls short</h2><p>Matching ran on gold-normalized line items. The identifier-heavy dataset favours this baseline and does not measure matching on AI-extracted items.</p>
        <p>
          The identifier/text baseline found {result.matching.truePositive} of {result.matching.truePositive + result.matching.falseNegative} expected equivalent
          pairs. It missed {result.matching.falseNegative} pairs and suggested {result.matching.falsePositive} false equivalences.
          On specifically annotated incompatible pairs, false equivalences were {result.matching.hardNegativeFalseEquivalences.numerator}/{result.matching.hardNegativeFalseEquivalences.denominator}.
          This small synthetic sample is not a
          general accuracy guarantee.
        </p>
      </section>
      <section>
        <h2>Read the limits alongside the results</h2>
        <p>
          Report mode: {result.mode}. AI status: {result.ai.status}.
          Read document coverage, failed requests and unmeasured cases alongside
          any field accuracy or matching result. A successful smoke test does
          not establish general reliability. Model responses injected into tests
          verify safeguards only; they are not model performance measurements.
        </p>
        <p>
          A separate agent checked five originals, 30 rows and 200 core expected
          values, plus five pair judgments. This was a scoped independent
          review, not a human audit of the full benchmark.
        </p>
      </section>
      <section>
        <h2>Reproduce and inspect</h2>
        <p>
          The detailed report includes denominators, configuration hashes,
          limitations and per-document results. The repository contains
          self-authored source documents, gold annotations and the resumable
          evaluation script.
        </p>
        <div className="inline-actions">
          <a className="button primary" href="/evaluation-report.md" download>
            Download measured report
          </a>
          <a
            className="button secondary"
            href="/evaluation-results.json"
            download
          >
            Download raw results
          </a>
          <Link className="text-button" href="/comparisons/demo-studio/compare">
            Explore the comparison →
          </Link>
        </div>
        <small>Run: {result.measuredAt} · {result.mode} · {result.split}</small>
      </section>
    </main>
  );
}
