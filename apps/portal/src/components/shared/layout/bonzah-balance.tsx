"use client";

import { useBonzahBalance } from "@/hooks/use-bonzah-balance";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function BonzahBalance() {
  const { balanceNumber, testBalanceNumber, isBonzahConnected, bonzahMode, portalUrl } =
    useBonzahBalance();

  if (!isBonzahConnected || balanceNumber == null) return null;

  const isLow = balanceNumber < 50;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={portalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium transition-colors hover:bg-accent ${
            isLow
              ? "text-red-600 dark:text-red-400"
              : "text-[#404040] dark:text-gray-300"
          }`}
        >
          <img src="/bonzah-logo.svg" alt="Bonzah" className="h-4 w-auto dark:hidden" />
          <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="h-4 w-auto hidden dark:block" />
          <span>${balanceNumber.toFixed(0)}</span>
        </a>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5 text-xs">
          <p>
            Bonzah {bonzahMode} balance:{" "}
            <span className={isLow ? "text-red-400 font-medium" : "font-medium"}>
              ${balanceNumber.toFixed(2)}
            </span>
            {isLow && " (low)"}
          </p>
          {bonzahMode === "live" && testBalanceNumber != null && (
            <p>
              Test balance: <span className="font-medium">${testBalanceNumber.toFixed(2)}</span>
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
