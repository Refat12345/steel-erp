"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask } from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_PAGE_WIDTH = 1000;

/**
 * Renders a PDF into canvases instead of relying on the browser's built-in
 * viewer, which is blank inside frames on some browsers and absent on Android.
 */
export function PdfCanvasViewer({
  src,
  loadingLabel,
  errorLabel,
}: {
  src: string;
  loadingLabel: string;
  errorLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    container.replaceChildren();
    setLoading(true);
    setFailed(false);

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const response = await fetch(src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;

        loadingTask = pdfjs.getDocument({ data, isEvalSupported: false });
        const pdf = await loadingTask.promise;
        const targetWidth = Math.min(container.clientWidth - 16, MAX_PAGE_WIDTH);
        const ratio = window.devicePixelRatio || 1;

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNumber);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: targetWidth / base.width });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          canvas.className = "mx-auto mb-3 block max-w-full bg-white shadow-sm";
          container.appendChild(canvas);

          const context = canvas.getContext("2d");
          if (!context) continue;
          await page.render({
            canvasContext: context,
            viewport,
            transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
          }).promise;
          if (pageNumber === 1 && !cancelled) setLoading(false);
        }
        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [src]);

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-2">
      {loading && <p className="p-2 text-sm text-muted-foreground">{loadingLabel}</p>}
      {failed && <p className="p-2 text-sm text-destructive">{errorLabel}</p>}
      <div ref={containerRef} dir="ltr" />
    </div>
  );
}
