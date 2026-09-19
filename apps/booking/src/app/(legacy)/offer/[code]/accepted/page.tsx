import { CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default function OfferAcceptedPage() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
        <div className="flex justify-center">
          <CheckCircle2 className="h-10 w-10 text-primary" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold">Awesome — you're picked!</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We'll text you the agreement and deposit link in a moment.
        </p>
      </div>
    </main>
  );
}
