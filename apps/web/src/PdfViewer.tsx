import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

function Page({
  pdf,
  page,
  title,
  width,
  zoom,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  title: string;
  width: number;
  zoom: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  useEffect(() => {
    let cancelled = false;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    void (async () => {
      try {
        const source = await pdf.getPage(page);
        if (cancelled) return;
        const base = source.getViewport({ scale: 1 });
        const viewport = source.getViewport({
          scale: Math.max(0.1, (width - 32) / base.width) * zoom,
        });
        const outputScale = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        const target = canvas.current!;
        target.width = Math.floor(viewport.width * outputScale);
        target.height = Math.floor(viewport.height * outputScale);
        target.style.width = `${viewport.width}px`;
        target.style.height = `${viewport.height}px`;
        render = source.render({
          canvas: target,
          viewport,
          transform: [outputScale, 0, 0, outputScale, 0, 0],
        });
        await render.promise;
        if (cancelled) return;
        setReady(true);
        const content = await source.getTextContent();
        if (!cancelled)
          setText(
            content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" "),
          );
      } catch {
        if (!cancelled)
          setError(
            "This page could not be rendered. Try page images or download the original.",
          );
      }
    })();
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [pdf, page, width, zoom]);
  return (
    <>
      {!ready && !error && (
        <p className="pdf-loading muted" role="status">
          Rendering page {page}…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="pdf-canvas-scroll">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Page ${page} of ${title}`}
          aria-busy={!ready}
          hidden={!ready}
        />
      </div>
      {ready && (
        <details className="pdf-page-text">
          <summary>Read page text</summary>
          <p>
            {text ||
              "No extractable text on this page. The visual page is shown above."}
          </p>
        </details>
      )}
    </>
  );
}

export default function PdfViewer({
  url,
  page,
  title,
}: {
  url: string;
  page: number;
  title: string;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width)),
    );
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setError("");
    const task = getDocument({
      url,
      withCredentials: true,
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
    });
    void task.promise
      .then((document) => {
        if (!cancelled) setPdf(document);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "The PDF could not be opened. Retry, use page images, or download the original.",
          );
      });
    return () => {
      cancelled = true;
      void task.destroy().catch(() => {});
    };
  }, [url, retry]);
  return (
    <div
      ref={host}
      className="pdf-renderer"
      aria-label={`PDF preview: ${title}`}
    >
      <div className="pdf-zoom">
        <label>
          Zoom
          <select
            aria-label="PDF zoom"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          >
            <option value={1}>Fit width</option>
            <option value={1.25}>125%</option>
            <option value={1.5}>150%</option>
            <option value={2}>200%</option>
          </select>
        </label>
      </div>
      {error ? (
        <div className="pdf-loading">
          <p className="error" role="alert">
            {error}
          </p>
          <button className="secondary" onClick={() => setRetry(retry + 1)}>
            Retry PDF
          </button>
        </div>
      ) : pdf && width > 0 ? (
        <Page
          key={`${page}-${width}-${zoom}-${retry}`}
          pdf={pdf}
          page={page}
          title={title}
          width={width}
          zoom={zoom}
        />
      ) : (
        <p className="pdf-loading muted" role="status">
          Loading PDF…
        </p>
      )}
    </div>
  );
}
