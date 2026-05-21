"use client";

import * as pdfjsLib from "pdfjs-dist";

// Load worker from CDN to avoid Next.js bundler complications.
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

/**
 * Render the first page of a PDF File to a PNG Blob.
 * Used to feed PDFs into OpenAI Vision, which can't ingest PDFs directly.
 */
export async function pdfToImage(
  file: File,
  scale = 2,
): Promise<{ blob: Blob; width: number; height: number }> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to acquire 2D context");

  // Fill white background so transparent areas render correctly as JPEG/PNG
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
      "image/png",
      0.92,
    );
  });

  await pdf.destroy();

  return { blob, width: canvas.width, height: canvas.height };
}
