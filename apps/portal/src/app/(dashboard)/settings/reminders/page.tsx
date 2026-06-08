'use client';

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { SectionCard, StatusPill, Tile } from "@/components/bento";
import { useToast } from "@/hooks/use-toast";
import { Bell, Clock, Shield, SlidersHorizontal, FileText } from "lucide-react";

export default function ReminderSettings() {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch current settings
  const { data: settings = {}, refetch } = useQuery({
    queryKey: ["reminder-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reminder_settings")
        .select("setting_key, setting_value");

      if (error) throw error;

      return data.reduce((acc, item) => {
        acc[item.setting_key] = item.setting_value;
        return acc;
      }, {} as Record<string, any>);
    },
  });

  // Update settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (newSettings: Record<string, any>) => {
      const updates = Object.entries(newSettings).map(([key, value]) => ({
        setting_key: key,
        setting_value: value,
      }));

      const { error } = await supabase
        .from("reminder_settings")
        .upsert(updates, { onConflict: "setting_key" });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminder-settings"] });
      toast({ title: "Settings saved successfully" });
      setIsLoading(false);
    },
    onError: (error) => {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive"
      });
      setIsLoading(false);
    },
  });

  const handleSave = (key: string, value: any) => {
    setIsLoading(true);
    updateSettingsMutation.mutate({ [key]: value });
  };

  const handleToggle = (key: string, currentValue: boolean) => {
    handleSave(key, !currentValue);
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Reminder Settings</h1>
        <p className="text-muted-foreground">
          Configure reminder timing, delivery mode, and automation preferences
        </p>
      </div>

      {/* Delivery Mode */}
      <SectionCard
        icon={<Shield className="h-4 w-4" />}
        title="Delivery Mode"
        action={<StatusPill tone="neutral">In-App Only</StatusPill>}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">Current Mode</Label>
              <p className="text-sm text-muted-foreground">
                Reminders are delivered in-app only. External channels will be available later.
              </p>
            </div>
          </div>
          <Tile variant="inset" pad="compact">
            <p className="text-sm">
              <strong>Future Ready:</strong> Email and WhatsApp delivery will be enabled when external APIs are connected.
            </p>
          </Tile>
        </div>
      </SectionCard>

      {/* Timing Settings */}
      <SectionCard
        icon={<Clock className="h-4 w-4" />}
        title="Timing & Schedule"
      >
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label className="text-base">Timezone</Label>
              <Select
                value={settings.timezone || "Europe/London"}
                onValueChange={(value) => handleSave("timezone", value)}
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Europe/London">London (GMT/BST)</SelectItem>
                  <SelectItem value="America/New_York">New York (EST/EDT)</SelectItem>
                  <SelectItem value="America/Los_Angeles">Los Angeles (PST/PDT)</SelectItem>
                  <SelectItem value="Europe/Berlin">Berlin (CET/CEST)</SelectItem>
                  <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-base">Send Time</Label>
              <Select
                value={settings.send_time || "09:00"}
                onValueChange={(value) => handleSave("send_time", value)}
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="08:00">08:00</SelectItem>
                  <SelectItem value="09:00">09:00</SelectItem>
                  <SelectItem value="10:00">10:00</SelectItem>
                  <SelectItem value="11:00">11:00</SelectItem>
                  <SelectItem value="12:00">12:00</SelectItem>
                  <SelectItem value="14:00">14:00</SelectItem>
                  <SelectItem value="16:00">16:00</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Reminder Types */}
      <SectionCard
        icon={<Bell className="h-4 w-4" />}
        title="Reminder Types"
      >
        <div className="space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base">Upcoming Reminders</Label>
                <p className="text-sm text-muted-foreground">
                  Send reminder 2 days before payment due date
                </p>
              </div>
              <Switch
                checked={settings.upcoming_enabled === true}
                onCheckedChange={() => handleToggle("upcoming_enabled", settings.upcoming_enabled === true)}
                disabled={isLoading}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base">Due Date Reminders</Label>
                <p className="text-sm text-muted-foreground">
                  Send reminder on payment due date
                </p>
              </div>
              <Switch
                checked={settings.due_enabled === true}
                onCheckedChange={() => handleToggle("due_enabled", settings.due_enabled === true)}
                disabled={isLoading}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base">Overdue Reminders</Label>
                <p className="text-sm text-muted-foreground">
                  Send reminders for overdue payments (1 day, then weekly up to 4 times)
                </p>
              </div>
              <Switch
                checked={settings.overdue_enabled === true}
                onCheckedChange={() => handleToggle("overdue_enabled", settings.overdue_enabled === true)}
                disabled={isLoading}
              />
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Advanced Settings */}
      <SectionCard
        icon={<SlidersHorizontal className="h-4 w-4" />}
        title="Advanced Settings"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">Respect Credit Coverage</Label>
              <p className="text-sm text-muted-foreground">
                Skip reminders when customer has sufficient credit to cover the charge
              </p>
            </div>
            <Switch
              checked={settings.respect_credit_coverage === true}
              onCheckedChange={() => handleToggle("respect_credit_coverage", settings.respect_credit_coverage === true)}
              disabled={isLoading}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label className="text-base">Maximum Overdue Reminders</Label>
              <Select
                value={String(settings.max_overdue_reminders || 4)}
                onValueChange={(value) => handleSave("max_overdue_reminders", parseInt(value))}
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 reminder</SelectItem>
                  <SelectItem value="2">2 reminders</SelectItem>
                  <SelectItem value="3">3 reminders</SelectItem>
                  <SelectItem value="4">4 reminders</SelectItem>
                  <SelectItem value="5">5 reminders</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base">Warranty Due Today</Label>
                <p className="text-sm text-muted-foreground">
                  Notify when warranty expires today
                </p>
              </div>
              <Switch
                checked={settings.reminder_warranty_due_today === true}
                onCheckedChange={() => handleToggle("reminder_warranty_due_today", settings.reminder_warranty_due_today === true)}
                disabled={isLoading}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base">Warranty Expiring Soon</Label>
                <p className="text-sm text-muted-foreground">
                  Notify when warranty expires in 30 days
                </p>
              </div>
              <Switch
                checked={settings.reminder_warranty_expiring_soon === true}
                onCheckedChange={() => handleToggle("reminder_warranty_expiring_soon", settings.reminder_warranty_expiring_soon === true)}
                disabled={isLoading}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base">Warranty Expired</Label>
                <p className="text-sm text-muted-foreground">
                  Notify when warranty has expired
                </p>
              </div>
              <Switch
                checked={settings.reminder_warranty_expired === true}
                onCheckedChange={() => handleToggle("reminder_warranty_expired", settings.reminder_warranty_expired === true)}
                disabled={isLoading}
              />
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Message Templates Preview */}
      <SectionCard
        icon={<FileText className="h-4 w-4" />}
        title="Message Templates"
      >
        <div className="space-y-4">
          <div className="space-y-3">
            <Tile variant="inset" pad="compact" className="space-y-1">
              <StatusPill tone="info">Upcoming</StatusPill>
              <p className="text-sm text-muted-foreground">
                <span className="font-mono tabular-nums">$250.00</span> due on <span className="font-mono tabular-nums">2024-01-15</span> for <span className="font-mono">ABC123</span> – will notify customer on due date once channels are connected.
              </p>
            </Tile>

            <Tile variant="inset" pad="compact" className="space-y-1">
              <StatusPill tone="warn">Due Today</StatusPill>
              <p className="text-sm text-muted-foreground">
                <span className="font-mono tabular-nums">$250.00</span> due today for <span className="font-mono">ABC123</span>.
              </p>
            </Tile>

            <Tile variant="inset" pad="compact" className="space-y-1">
              <StatusPill tone="danger">Overdue</StatusPill>
              <p className="text-sm text-muted-foreground">
                <span className="font-mono tabular-nums">$250.00</span> overdue for <span className="font-mono">ABC123</span> (since <span className="font-mono tabular-nums">2024-01-15</span>).
              </p>
            </Tile>
          </div>

          <p className="text-sm text-muted-foreground">
            Custom message templates will be available when external delivery channels are enabled.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
