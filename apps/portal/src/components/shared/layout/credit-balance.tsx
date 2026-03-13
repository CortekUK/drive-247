"use client";

import Link from "next/link";
import { CircleDollarSign } from "lucide-react";
import { useCreditWallet } from "@/hooks/use-credit-wallet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function CreditBalance() {
  const { balance, testBalance, isLowBalance, isLoading } = useCreditWallet();

  if (isLoading) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/credits"
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium transition-colors hover:bg-accent ${
            isLowBalance
              ? "text-red-600 dark:text-red-400"
              : "text-[#404040] dark:text-gray-300"
          }`}
        >
          <CircleDollarSign className={`h-4 w-4 ${isLowBalance ? "text-red-500" : "text-emerald-500"}`} />
          <span>{balance.toFixed(0)}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5 text-xs">
          <p>
            Live credits:{" "}
            <span className={isLowBalance ? "text-red-400 font-medium" : "font-medium"}>
              {balance.toFixed(0)}
            </span>
            {isLowBalance && " (low)"}
          </p>
          <p>
            Test credits: <span className="font-medium">{testBalance.toFixed(0)}</span>
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
