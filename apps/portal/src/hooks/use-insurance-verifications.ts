import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface ExtractedInsuranceFields {
  insurer: string | null;
  policy_number: string | null;
  policy_holder: string | null;
  coverage_type: string | null;
  start_date: string | null;
  end_date: string | null;
  vehicle_info: string | null;
  premium_amount: string | null;
  country: string | null;
}

export interface InsuranceVerificationFindings {
  flags: string[];
  reasoning: string;
  is_insurance_document: boolean;
  model: string;
}

export interface InsuranceVerification {
  id: string;
  tenant_id: string;
  rental_id: string | null;
  customer_id: string | null;
  file_url: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  status:
    | "pending"
    | "processing"
    | "verified"
    | "flagged"
    | "rejected"
    | "failed";
  ai_score: number | null;
  ai_findings: InsuranceVerificationFindings | null;
  extracted_fields: ExtractedInsuranceFields | null;
  ai_error: string | null;
  uploaded_by: string | null;
  attached_by: string | null;
  attached_at: string | null;
  created_at: string;
  updated_at: string;
  rentals?: {
    id: string;
    rental_number?: string | null;
    customers?: { name: string | null } | null;
  } | null;
}

const BUCKET = "insurance-verifications";

export function useInsuranceVerifications() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["insurance-verifications", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_verifications")
        .select(
          `*, rentals!insurance_verifications_rental_id_fkey ( id, rental_number, customers!rentals_customer_id_fkey ( name ) )`,
        )
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as InsuranceVerification[];
    },
    enabled: !!tenant,
    refetchInterval: (q) => {
      const rows = (q.state.data || []) as InsuranceVerification[];
      return rows.some(
        (r) => r.status === "pending" || r.status === "processing",
      )
        ? 2500
        : false;
    },
  });
}

export function useRentalInsuranceVerifications(rentalId: string | undefined) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["insurance-verifications", "by-rental", rentalId, tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_verifications")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .eq("rental_id", rentalId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as InsuranceVerification[];
    },
    enabled: !!tenant && !!rentalId,
  });
}

export function useUploadAndVerifyInsurance() {
  const { tenant } = useTenant();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      if (!tenant) throw new Error("No tenant");

      // 1) Create DB row first so storage path is keyed by id
      const { data: row, error: insertErr } = await supabase
        .from("insurance_verifications")
        .insert({
          tenant_id: tenant.id,
          file_url: "", // placeholder, updated after upload
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || null,
          status: "pending",
        })
        .select("id")
        .single();
      if (insertErr || !row) throw insertErr ?? new Error("Insert failed");

      const verificationId = row.id;
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const path = `${tenant.id}/${verificationId}/file.${ext}`;

      // 2) Upload to storage
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
          contentType: file.type || undefined,
          upsert: true,
        });
      if (upErr) {
        await supabase
          .from("insurance_verifications")
          .delete()
          .eq("id", verificationId);
        throw upErr;
      }

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

      // 3) Update row with file_url
      const { error: updErr } = await supabase
        .from("insurance_verifications")
        .update({ file_url: urlData.publicUrl })
        .eq("id", verificationId);
      if (updErr) throw updErr;

      // 4) Kick off AI verification — fire and forget so the UI doesn't block.
      // The row will move pending → processing → verified/flagged/rejected,
      // and the list polls every 2.5s until done.
      supabase.functions
        .invoke("verify-insurance-document", { body: { verificationId } })
        .catch((e) => console.warn("verify-insurance-document invoke error", e));

      return verificationId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insurance-verifications", tenant?.id] });
    },
  });
}

export function useReverifyInsurance() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (verificationId: string) => {
      await supabase
        .from("insurance_verifications")
        .update({ status: "pending", ai_error: null })
        .eq("id", verificationId);
      const { error } = await supabase.functions.invoke(
        "verify-insurance-document",
        { body: { verificationId } },
      );
      if (error) console.warn("reverify error", error);
      return verificationId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insurance-verifications", tenant?.id] });
    },
  });
}

export function useAttachInsuranceVerification() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      verificationId,
      rentalId,
    }: {
      verificationId: string;
      rentalId: string | null;
    }) => {
      let customerId: string | null = null;
      if (rentalId) {
        const { data: rental } = await supabase
          .from("rentals")
          .select("customer_id")
          .eq("id", rentalId)
          .single();
        customerId = rental?.customer_id ?? null;
      }
      const { error } = await supabase
        .from("insurance_verifications")
        .update({
          rental_id: rentalId,
          customer_id: customerId,
          attached_at: rentalId ? new Date().toISOString() : null,
        })
        .eq("id", verificationId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({
        queryKey: ["insurance-verifications", tenant?.id],
      });
      qc.invalidateQueries({
        queryKey: ["insurance-verifications", "by-rental"],
      });
      if (vars.rentalId) {
        qc.invalidateQueries({
          queryKey: ["insurance-verifications", "by-rental", vars.rentalId],
        });
      }
    },
  });
}

export function useDeleteInsuranceVerification() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (verificationId: string) => {
      // Best-effort storage cleanup
      const { data: row } = await supabase
        .from("insurance_verifications")
        .select("file_url")
        .eq("id", verificationId)
        .single();
      if (row?.file_url) {
        const m = row.file_url.match(
          /\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/,
        );
        if (m) {
          await supabase.storage.from(BUCKET).remove([m[1]]);
        }
      }
      const { error } = await supabase
        .from("insurance_verifications")
        .delete()
        .eq("id", verificationId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["insurance-verifications", tenant?.id],
      });
    },
  });
}
