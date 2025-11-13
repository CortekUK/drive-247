import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Bell, Scale, Loader2 } from "lucide-react";
import { logAuditEvent, generateFieldSummary } from "@/lib/auditLogger";

// Validation schemas
const companySchema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  phone: z.string().refine((val) => {
    const cleaned = val.replace(/[\s\-()]/g, '');
    const digitCount = (cleaned.match(/\d/g) || []).length;
    return digitCount >= 7 && digitCount <= 15;
  }, "Please enter a valid phone number (7-15 digits)"),
  email: z.string().email("Invalid email address"),
  office_address: z.string().min(1, "Address is required"),
  availability: z.string().min(1, "Availability is required"),
  whatsapp_number: z.string().refine((val) => {
    if (!val || val === "") return true;
    const cleaned = val.replace(/[\s\-()]/g, '');
    const digitCount = (cleaned.match(/\d/g) || []).length;
    return digitCount >= 7 && digitCount <= 15;
  }, "Please enter a valid phone number (7-15 digits)").optional().or(z.literal("")),
});

const notificationsSchema = z.object({
  notify_new_booking: z.boolean(),
  notify_new_enquiry: z.boolean(),
  notification_emails: z.string(),
});

const legalSchema = z.object({
  privacy_policy_url: z.string().url("Invalid URL").or(z.string().startsWith("/")),
  terms_url: z.string().url("Invalid URL").or(z.string().startsWith("/")),
  footer_tagline: z.string().max(200, "Tagline must be under 200 characters"),
  instagram_url: z.string().url("Invalid URL").optional().or(z.literal("")),
  facebook_url: z.string().url("Invalid URL").optional().or(z.literal("")),
  linkedin_url: z.string().url("Invalid URL").optional().or(z.literal("")),
});

type CompanyData = z.infer<typeof companySchema>;
type NotificationsData = z.infer<typeof notificationsSchema>;
type LegalData = z.infer<typeof legalSchema>;

export default function SiteSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");

  const companyForm = useForm<CompanyData>({
    resolver: zodResolver(companySchema),
  });

  const notificationsForm = useForm<NotificationsData>({
    resolver: zodResolver(notificationsSchema),
  });

  const legalForm = useForm<LegalData>({
    resolver: zodResolver(legalSchema),
  });

  useEffect(() => {
    loadSettings();
    loadUserEmail();
  }, []);

  const loadUserEmail = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) setUserEmail(user.email);
  };

  const loadSettings = async () => {
    try {
      setLoading(true);
      
      // Force fresh data by adding a cache-busting filter that's always true
      // This makes each query unique and bypasses Supabase client-side caching
      const { data, error } = await supabase
        .from("site_settings")
        .select("*")
        .gte('created_at', '1970-01-01') // Cache-buster: always true, but makes query unique
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;

      if (data) {
        setSettingsId(data.id);
        
        companyForm.reset({
          company_name: data.company_name,
          phone: data.phone,
          email: data.email,
          office_address: data.office_address,
          availability: data.availability,
          whatsapp_number: data.whatsapp_number || "",
        });

        notificationsForm.reset({
          notify_new_booking: data.notify_new_booking,
          notify_new_enquiry: data.notify_new_enquiry,
          notification_emails: (data.notification_emails || []).join(", "),
        });

        legalForm.reset({
          privacy_policy_url: data.privacy_policy_url || "",
          terms_url: data.terms_url || "",
          footer_tagline: data.footer_tagline || "",
          instagram_url: data.instagram_url || "",
          facebook_url: data.facebook_url || "",
          linkedin_url: data.linkedin_url || "",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getCurrentSettings = async () => {
    // Force fresh data by adding cache-busting filter
    const { data } = await supabase
      .from("site_settings")
      .select("*")
      .eq("id", settingsId)
      .gte('created_at', '1970-01-01') // Cache-buster: always true, but makes query unique
      .single();
    return data;
  };

  const saveCompany = async (data: CompanyData) => {
    if (!settingsId) return;

    try {
      setSaving(true);
      const before = await getCurrentSettings();

      const { error } = await supabase
        .from("site_settings")
        .update(data)
        .eq("id", settingsId);

      if (error) throw error;

      const changedFields = Object.keys(data).filter(
        key => JSON.stringify(before?.[key]) !== JSON.stringify(data[key as keyof CompanyData])
      );

      await logAuditEvent({
        action: "update",
        entityType: "Site Settings",
        entityId: settingsId,
        summary: generateFieldSummary("Company & Contact", changedFields),
        before: before ? Object.fromEntries(changedFields.map(k => [k, before[k]])) : {},
        after: data,
      });

      // Invalidate cache to refresh settings across all components
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });

      toast({
        title: "Settings saved successfully",
        description: "Company information has been updated.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveNotifications = async (data: NotificationsData) => {
    if (!settingsId) return;

    try {
      setSaving(true);
      const before = await getCurrentSettings();

      const emailArray = data.notification_emails
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);

      const updateData = {
        notify_new_booking: data.notify_new_booking,
        notify_new_enquiry: data.notify_new_enquiry,
        notification_emails: emailArray,
      };

      const { error } = await supabase
        .from("site_settings")
        .update(updateData)
        .eq("id", settingsId);

      if (error) throw error;

      const changedFields = Object.keys(updateData).filter(
        key => JSON.stringify(before?.[key]) !== JSON.stringify(updateData[key as keyof typeof updateData])
      );

      await logAuditEvent({
        action: "update",
        entityType: "Site Settings",
        entityId: settingsId,
        summary: generateFieldSummary("Notifications", changedFields),
        before: before ? Object.fromEntries(changedFields.map(k => [k, before[k]])) : {},
        after: updateData,
      });

      // Invalidate cache to refresh settings across all components
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });

      toast({
        title: "Settings saved successfully",
        description: "Notification preferences have been updated.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveLegal = async (data: LegalData) => {
    if (!settingsId) return;

    try {
      setSaving(true);
      const before = await getCurrentSettings();

      const { error } = await supabase
        .from("site_settings")
        .update(data)
        .eq("id", settingsId);

      if (error) throw error;

      const changedFields = Object.keys(data).filter(
        key => JSON.stringify(before?.[key]) !== JSON.stringify(data[key as keyof LegalData])
      );

      await logAuditEvent({
        action: "update",
        entityType: "Site Settings",
        entityId: settingsId,
        summary: generateFieldSummary("Legal & Footer", changedFields),
        before: before ? Object.fromEntries(changedFields.map(k => [k, before[k]])) : {},
        after: data,
      });

      // Invalidate cache to refresh settings across all components
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });

      toast({
        title: "Settings saved successfully",
        description: "Legal and footer information has been updated.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-96" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">
          Site Settings
        </h1>
        <p className="text-muted-foreground">
          Manage global site configuration
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Company & Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              Company & Contact
            </CardTitle>
            <CardDescription>
              Update company information and contact details
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...companyForm}>
              <form onSubmit={companyForm.handleSubmit(saveCompany)} className="space-y-4">
                <FormField
                  control={companyForm.control}
                  name="company_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={companyForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="+44 800 123 4567" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={companyForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input {...field} type="email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={companyForm.control}
                  name="office_address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Office Address</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={3} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={companyForm.control}
                  name="availability"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Availability</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="24 hours a day, 7 days a week" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={companyForm.control}
                  name="whatsapp_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>WhatsApp Number (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="+44 7900 123456" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full" disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>


      </div>
    </div>
  );
}