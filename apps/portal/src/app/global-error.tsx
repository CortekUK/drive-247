"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown in the root layout / providers, i.e.
 * above every segment `error.tsx`. Next.js replaces the whole document here, so
 * this file must render its own <html> and <body> and cannot rely on the app's
 * CSS being applied — hence the inline styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[portal] fatal render error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          margin: 0,
          background: "#f8fafc",
          color: "#0f172a",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
            The portal didn&apos;t load
          </h1>
          <p style={{ color: "#64748b", margin: "0 0 24px", fontSize: 14 }}>
            Something went wrong before the page could start. Reloading usually
            clears it.
          </p>
          <button
            onClick={reset}
            style={{
              background: "#0f172a",
              color: "#fff",
              border: 0,
              borderRadius: 6,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload the portal
          </button>
          {error?.digest && (
            <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 24 }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
