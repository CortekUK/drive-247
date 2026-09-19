import { ApplyForm } from "@/components/apply/apply-form";

export const dynamic = "force-dynamic";

export default function ApplyPage() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-muted/30">
      <ApplyForm />
    </main>
  );
}
