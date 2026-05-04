"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface SuperAdmin {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
}

/**
 * List of all active super-admin app_users — used for the assignee picker.
 */
export function useSuperAdmins() {
  const [admins, setAdmins] = useState<SuperAdmin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("app_users")
        .select("id, name, email, avatar_url")
        .eq("is_super_admin", true)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("useSuperAdmins:", error);
        setAdmins([]);
      } else {
        setAdmins((data ?? []) as SuperAdmin[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { admins, loading };
}
