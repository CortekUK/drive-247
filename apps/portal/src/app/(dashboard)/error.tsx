"use client";

import { useEffect } from "react";

/**
 * Segment error boundary for every dashboard page.
 *
 * Without this, ANY uncaught render error inside the dashboard fell through to
 * Next.js's built-in fallback — a bare white page reading "Application error: a
 * client-side exception has occurred while loading <host>". It offered the
 * operator no reload, no context and no way forward, and told us nothing about
 * what actually threw. A TDZ bug on the New Rental page surfaced exactly that
 * way and read to the tenant as the whole portal being down.
 *
 * Deliberately dependency-free (no UI kit, no providers): this renders in the
 * middle of a broken tree, so anything it imports is another thing that can
 * throw and take the fallback down with it.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep the real error in the console — the built-in fallback swallowed it,
    // which is why the only diagnosis available was a photo of the screen.
    console.error("[portal] dashboard render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <h1 className="mb-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
          This page didn&apos;t load
        </h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
          Something went wrong while rendering it. Your data is safe — nothing
          was saved or changed.
        </p>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
          >
            Back to dashboard
          </a>
        </div>

        {error?.digest && (
          <p className="mt-6 text-xs text-slate-400">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
