"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="standalone"><h1>This view could not be opened.</h1><p>Your original files and saved comparisons are preserved. Reload this view to try again.</p><div className="inline-actions"><button className="button primary" onClick={reset}>Try again</button><Link className="button secondary" href="/">Return to workspace</Link></div></main>;
}
