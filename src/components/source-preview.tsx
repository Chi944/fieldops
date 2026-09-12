"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { Quotation, SourceSpan } from "@/lib/domain/types";

/** Renders the real bytes. Overlay geometry comes only from parser coordinates. */
export function SourcePreview({
  quotation,
  selected,
}: {
  quotation: Quotation;
  selected: SourceSpan[];
}) {
  const isPdf = quotation.format === "pdf";
  const isImage = ["png", "jpg", "jpeg"].includes(quotation.format);
  const selectedPage = selected.find((s) => s.page)?.page;
  const [manualPage, setManualPage] = useState(1),
    [pages, setPages] = useState(1);
  const page = selectedPage ?? manualPage;
  const [status, setStatus] = useState(""),
    [loading, setLoading] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const url =
    quotation.sourceUrl ?? `/api/documents/${quotation.documentId}/source`;
  useEffect(() => {
    if (quotation.isDemo || (!isPdf && !isImage)) return;
    const abort = new AbortController();
    let destroyed = false;
    let destroyPdf: (() => Promise<void>) | undefined;
    void (async () => {
      setLoading(true);
      setStatus("");
      try {
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok)
          throw new Error(
            "The original could not be opened. Sign in again or retry.",
          );
        const bytes = await response.arrayBuffer();
        if (isPdf) {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
          const task = pdfjs.getDocument({ data: bytes });
          destroyPdf = () => task.destroy();
          const pdf = await task.promise;
          if (destroyed) return;
          setPages(pdf.numPages);
          const documentPage = await pdf.getPage(Math.min(page, pdf.numPages));
          const viewport = documentPage.getViewport({ scale: 1.5 });
          if (!canvas.current || destroyed) return;
          canvas.current.width = viewport.width;
          canvas.current.height = viewport.height;
          await documentPage.render({ canvas: canvas.current, viewport })
            .promise;
        } else {
          const bitmap = await createImageBitmap(new Blob([bytes]));
          if (!canvas.current || destroyed) {
            bitmap.close();
            return;
          }
          canvas.current.width = bitmap.width;
          canvas.current.height = bitmap.height;
          canvas.current.getContext("2d")?.drawImage(bitmap, 0, 0);
          bitmap.close();
        }
        if (!destroyed) setLoading(false);
      } catch (error) {
        if (!destroyed && !abort.signal.aborted) {
          setStatus(
            (error as Error).message ||
              "Preview unavailable. Open the original file instead.",
          );
          setLoading(false);
        }
      }
    })();
    return () => {
      destroyed = true;
      abort.abort();
      void destroyPdf?.();
    };
  }, [url, page, quotation.isDemo, isPdf, isImage]);
  if (quotation.isDemo || (!isPdf && !isImage)) return null;
  return (
    <section
      className="original-preview"
      aria-label="Original document preview"
    >
      <div className="original-preview-toolbar">
        <strong>
          Original {isPdf ? `· page ${page} of ${pages}` : "image"}
        </strong>
        {isPdf && (
          <div>
            <button
              className="icon-button"
              aria-label="Previous source page"
              disabled={page <= 1 || !!selectedPage}
              onClick={() => setManualPage(page - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Next source page"
              disabled={page >= pages || !!selectedPage}
              onClick={() => setManualPage(page + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
      {loading && (
        <p className="preview-status" role="status">
          <Loader2 size={15} className="spin" />
          Opening the original…
        </p>
      )}
      {status && (
        <p className="notice-box" role="alert">
          {status}
        </p>
      )}
      <div
        className="preview-canvas-wrap"
        style={{ display: loading || status ? "none" : undefined }}
      >
        <canvas
          ref={canvas}
          aria-label={`Original ${quotation.filename}, page ${page}`}
        />
        {selected
          .filter(
            (s) =>
              s.box &&
              s.pageWidth &&
              s.pageHeight &&
              (!isPdf || s.page === page),
          )
          .map((s) => (
            <span
              key={s.id}
              className="source-region"
              aria-label="Parser evidence region"
              style={{
                left: `${(s.box!.x / s.pageWidth!) * 100}%`,
                top: `${(s.box!.y / s.pageHeight!) * 100}%`,
                width: `${(s.box!.width / s.pageWidth!) * 100}%`,
                height: `${(s.box!.height / s.pageHeight!) * 100}%`,
              }}
            />
          ))}
      </div>
      <p className="small muted">
        {selectedPage
          ? "Showing the selected field’s page. Clear the selection to browse pages."
          : "Select an extracted field to locate its evidence."}
      </p>
    </section>
  );
}
