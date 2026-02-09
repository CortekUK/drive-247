import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link2, Copy, Check, Loader2, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { format } from "date-fns";

interface GenerateInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GenerateInviteDialog({ open, onOpenChange }: GenerateInviteDialogProps) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (!tenant?.id || !tenant?.slug) {
      toast({
        title: "Error",
        description: "Tenant information not available.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-customer-invite', {
        body: {
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
        },
      });

      if (error) throw error;

      if (!data?.ok) {
        throw new Error(data?.error || 'Failed to generate invite link');
      }

      setInviteUrl(data.url);
      setExpiresAt(data.expiresAt);
    } catch (error: any) {
      console.error('Error generating invite:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to generate invite link.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast({
        title: "Copied",
        description: "Invite link copied to clipboard.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard.",
        variant: "destructive",
      });
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setInviteUrl(null);
      setExpiresAt(null);
      setCopied(false);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            Customer Registration Link
          </DialogTitle>
          <DialogDescription>
            Generate a link that customers can use to register themselves. The link includes a registration form and optional ID verification.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!inviteUrl ? (
            <div className="text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                The link will be valid for 7 days. The customer can fill out their details and optionally complete ID verification.
              </p>
              <Button
                onClick={handleGenerate}
                disabled={loading}
                className="bg-gradient-primary"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Link2 className="h-4 w-4 mr-2" />
                    Generate Link
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <input
                  type="text"
                  readOnly
                  value={inviteUrl}
                  className="flex-1 bg-transparent text-sm truncate border-none focus:outline-none"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {expiresAt && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>Expires {format(new Date(expiresAt), "MMM d, yyyy 'at' h:mm a")}</span>
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => handleClose(false)}>
                  Close
                </Button>
                <Button onClick={handleGenerate} disabled={loading} variant="secondary">
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Link2 className="h-4 w-4 mr-2" />
                  )}
                  Generate New
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
