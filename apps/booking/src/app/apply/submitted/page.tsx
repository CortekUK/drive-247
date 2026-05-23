"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import { CheckCircle2, AlertCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function ApplySubmittedPage() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params?.get("status") ?? "received";

  const view = useMemo(() => {
    if (status === "blacklisted") {
      // Per spec §6.7: NEVER tell the customer they were blacklisted.
      // Show a generic "we'll be in touch" message.
      return {
        Icon: Mail,
        tone: "bg-card text-card-foreground",
        title: "Thanks — we've received your application",
        body: "Our team will review your application and reach out within the next business day.",
      };
    }
    if (status === "duplicate_merged") {
      return {
        Icon: CheckCircle2,
        tone: "bg-card text-card-foreground",
        title: "We've added this to your existing application",
        body: "You already have an active application with us. We've appended this submission and our team will follow up shortly.",
      };
    }
    return {
      Icon: CheckCircle2,
      tone: "bg-card text-card-foreground",
      title: "We've got your application",
      body: "Watch your phone — we'll send you a confirmation SMS and reach out shortly.",
    };
  }, [status]);

  const Icon = view.Icon;

  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-muted/30 px-4">
      <div className={`w-full max-w-md space-y-6 rounded-lg border p-8 text-center shadow-sm ${view.tone}`}>
        <div className="flex justify-center">
          <Icon className="h-10 w-10 text-primary" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{view.title}</h1>
          <p className="text-sm text-muted-foreground">{view.body}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button variant="outline" onClick={() => router.push("/")}>Back to home</Button>
        </div>
      </div>
    </main>
  );
}
