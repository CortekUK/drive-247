"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, Copy, Link2, Mail, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import type { ReferralsData } from "@/hooks/use-referrals";

/**
 * Share your referral code: the code and link, and four icon-only actions —
 * copy code, copy link, WhatsApp, email — each named in its tooltip and
 * aria-label.
 */

function shareText(data: ReferralsData): string {
  const offer = data.refereeOffer ? ` You'll get ${data.refereeOffer.discountText} ${data.refereeOffer.durationText}.` : "";
  return `I run my rental business on Drive247 and I think you'd like it.${offer} Sign up with my link: ${data.code?.link ?? ""} (or use code ${data.code?.code ?? ""}).`;
}

function IconAction({
  icon: Icon,
  label,
  onClick,
  href,
  done,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  href?: string;
  done?: boolean;
}) {
  const cls =
    "flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-colors duration-200 ease-out hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none dark:text-[hsl(var(--v2-link,var(--primary)))]";
  const inner = done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" aria-label={label} className={cls}>
            {inner}
          </a>
        ) : (
          <button type="button" onClick={onClick} aria-label={label} className={cls}>
            {inner}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent>{done ? "Copied" : label}</TooltipContent>
    </Tooltip>
  );
}

export function ShareReferralDialogV2({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ReferralsData;
}) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const copy = async (what: "code" | "link", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Couldn't copy. Select it and copy by hand.");
    }
  };

  const code = data.code;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-7 sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>Share your code</DialogTitle>
          <DialogDescription>
            {data.refereeOffer
              ? `The operator you refer gets ${data.refereeOffer.discountText} ${data.refereeOffer.durationText}.`
              : "Send it to another rental operator."}
          </DialogDescription>
        </DialogHeader>

        {code ? (
          <>
            <div className="rounded-2xl bg-muted/50 px-5 py-4 text-center">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Your code</p>
              <p className="mt-1 font-mono text-2xl font-semibold tracking-wider">{code.code}</p>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={code.link}>
                {code.link}
              </p>
            </div>
            <div className="flex justify-center gap-3">
              <IconAction icon={Copy} label="Copy code" done={copied === "code"} onClick={() => copy("code", code.code)} />
              <IconAction icon={Link2} label="Copy link" done={copied === "link"} onClick={() => copy("link", code.link)} />
              <IconAction icon={MessageCircle} label="Share on WhatsApp" href={`https://wa.me/?text=${encodeURIComponent(shareText(data))}`} />
              <IconAction
                icon={Mail}
                label="Share by email"
                href={`mailto:?subject=${encodeURIComponent("Try Drive247 for your rental business")}&body=${encodeURIComponent(shareText(data))}`}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.subscribed ? "Your code is being set up. Check back in a few minutes." : "Your code appears once your Drive247 subscription is active."}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
