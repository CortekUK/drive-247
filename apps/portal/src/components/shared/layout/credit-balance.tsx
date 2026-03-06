"use client";

import Link from "next/link";
import { CircleDollarSign, FlaskConical } from "lucide-react";
import { useCreditWallet } from "@/hooks/use-credit-wallet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function CreditBalance() {
  const { balance, testBalance, isLowBalance, isLoading } = useCreditWallet();

  if (isLoading) return null;

  return (
    <div className="flex items-center gap-1">
      {/* Live balance */}
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
            <CircleDollarSign className={`h-4 w-4 ${isLowBalance ? "text-red-500" : "text-yellow-500"}`} />
            <span>{balance.toFixed(0)}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent>
          <p>Live credits: {balance.toFixed(0)} {isLowBalance ? "(low)" : ""}</p>
        </TooltipContent>
      </Tooltip>

      {/* Test balance — only show if > 0 */}
      {testBalance > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/credits"
              className="flex items-center gap-1 px-2 py-1.5 rounded-md text-sm font-medium text-amber-600 dark:text-amber-400 transition-colors hover:bg-accent"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>{testBalance.toFixed(0)}</span>
            </Link>
          </TooltipTrigger>
          <TooltipContent>
            <p>Test credits: {testBalance.toFixed(0)}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
