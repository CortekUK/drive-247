'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Copy, Check, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface UserCredentials {
  name: string;
  email: string;
  password: string;
}

interface CredentialsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credentials: UserCredentials | null;
}

export function CredentialsModal({ open, onOpenChange, credentials }: CredentialsModalProps) {
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);

  const copyToClipboard = async (text: string, type: 'email' | 'password') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'email') {
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 2000);
      } else {
        setCopiedPassword(true);
        setTimeout(() => setCopiedPassword(false), 2000);
      }
      toast({
        title: "Copied",
        description: `${type === 'email' ? 'Email' : 'Password'} copied to clipboard`,
      });
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleClose = () => {
    setCopiedEmail(false);
    setCopiedPassword(false);
    onOpenChange(false);
  };

  if (!credentials) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[500px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-green-600">
            <Check className="h-5 w-5" />
            User Created Successfully
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>
                <strong>{credentials.name}</strong> has been created. Save the credentials below -
                the password cannot be retrieved later.
              </p>

              <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  Make sure to save these credentials before closing. The password is shown only once and cannot be recovered.
                </p>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="cred-email">Email</Label>
            <div className="flex gap-2">
              <Input
                id="cred-email"
                value={credentials.email}
                readOnly
                className="font-mono bg-muted"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(credentials.email, 'email')}
              >
                {copiedEmail ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-password">Temporary Password</Label>
            <div className="flex gap-2">
              <Input
                id="cred-password"
                value={credentials.password}
                readOnly
                className="font-mono bg-muted"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(credentials.password, 'password')}
              >
                {copiedPassword ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The user will be required to change this password on first login.
            </p>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogAction onClick={handleClose} className="bg-gradient-primary">
            I've Saved the Credentials
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
