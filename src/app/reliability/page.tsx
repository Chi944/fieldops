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
        calculations separately. The figures below are real offline measurements
        on self-authored synthetic documents. Live AI extraction remains
        disabled and unverified.
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
          The dataset contains 144 line items across text PDFs, printed scans,
          images, XLSX, CSV and pasted text. Four scenarios form the development
          set and four are held out. Separate robustness assertions cover
          duplicates, revisions, protected or malformed files, unreadable
          images, size limits and malicious document instructions.
        </p>
        <p>
          All 24 documents produced complete parser manifests in this run. That
          means the parser accounted for its pages or sheets; it does not
          establish complete or accurate AI extraction.
        </p>
      </section>
      <section>
        <h2>Where the baseline falls short</h2><p>Matching ran on gold-normalized line items. The identifier-heavy dataset favours this baseline and does not measure matching on AI-extracted items.</p>
        <p>
          The identifier/text baseline found 102 of 116 expected equivalent
          pairs. It missed 14 pairs because a conflicting third offer made an
          entire candidate group conservative. No false equivalences were
          observed among 102 suggested pairs, including none on 28 specifically
          annotated incompatible pairs. This small synthetic sample is not a
          general accuracy guarantee.
        </p>
      </section>
      <section>
        <h2>What remains unverified</h2>
        <p>
          Live field extraction accuracy, AI-assisted matching, factual support
          of model interpretations, end-to-end inference latency and token cost
          have not been measured. Model responses injected into tests verify
          safeguards only. They are not evidence of model performance.
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
        <small>Run: {result.measuredAt} · baseline only</small>
      </section>
    </main>
  );
}
