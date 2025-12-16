'use client';

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Save, Bell, Clock, Shield } from "lucide-react";

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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Reminder Settings</h1>
        <p className="text-muted-foreground">
          Configure reminder timing, delivery mode, and automation preferences
        </p>
      </div>

      {/* Delivery Mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Delivery Mode
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">Current Mode</Label>
              <p className="text-sm text-muted-foreground">
                Reminders are delivered in-app only. External channels will be available later.
              </p>
            </div>
            <Badge variant="secondary">In-App Only</Badge>
          </div>
          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm">
              <strong>Future Ready:</strong> Email and WhatsApp delivery will be enabled when external APIs are connected.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Timing Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Timing & Schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
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
        </CardContent>
      </Card>

      {/* Reminder Types */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Reminder Types
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      {/* Advanced Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Advanced Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      {/* Message Templates Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Message Templates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="p-3 bg-blue-50 rounded-lg border-l-4 border-blue-400">
              <Label className="text-sm font-medium text-blue-800">Upcoming</Label>
              <p className="text-sm text-blue-700 mt-1">
                $250.00 due on 2024-01-15 for ABC123 – will notify customer on due date once channels are connected.
              </p>
            </div>

            <div className="p-3 bg-orange-50 rounded-lg border-l-4 border-orange-400">
              <Label className="text-sm font-medium text-orange-800">Due Today</Label>
              <p className="text-sm text-orange-700 mt-1">
                $250.00 due today for ABC123.
              </p>
            </div>

            <div className="p-3 bg-red-50 rounded-lg border-l-4 border-red-400">
              <Label className="text-sm font-medium text-red-800">Overdue</Label>
              <p className="text-sm text-red-700 mt-1">
                $250.00 overdue for ABC123 (since 2024-01-15).
              </p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Custom message templates will be available when external delivery channels are enabled.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
