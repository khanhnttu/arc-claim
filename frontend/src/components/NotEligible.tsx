"use client";

import type { Address } from "viem";
import { useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/format";
import { Button } from "./ui";

/**
 * Shown instead of a Claim button when the connected wallet is not the assigned recipient.
 * Purely informational — the contract rejects anyone but the recipient regardless.
 */
export function NotEligible({
  assignedTo,
  connected,
  isSender,
  what = "payment",
  showAssignee = true,
}: {
  assignedTo: Address;
  connected: Address;
  isSender: boolean;
  what?: "payment" | "airdrop";
  /** Show who the payment is assigned to. Off for unrelated wallets, who should not see payment details. */
  showAssignee?: boolean;
}) {
  const { disconnect } = useDisconnect();
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-4">
      <p className="flex items-center gap-2 font-semibold">
        <span aria-hidden>{"\u{1F512}"}</span>
        {isSender ? "You are the sender" : "Not eligible to claim"}
      </p>
      <p className="mt-1 text-sm text-muted">
        {isSender
          ? what === "payment"
            ? "This payment is assigned to the recipient above."
            : "Airdrop allocations can only be claimed by their recipients."
          : what === "payment"
            ? "This payment is assigned to another wallet."
            : "This airdrop has no allocation for the connected wallet."}
      </p>
      <dl className="mt-3 space-y-2 text-sm">
        {what === "payment" && showAssignee && (
          <div>
            <dt className="text-muted">Assigned to</dt>
            <dd className="mt-0.5 font-mono font-medium break-all" title={assignedTo}>
              {shortAddress(assignedTo)}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-muted">Connected wallet</dt>
          <dd className="mt-0.5 font-mono font-medium break-all" title={connected}>
            {shortAddress(connected)}
          </dd>
        </div>
      </dl>
      {!isSender && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => disconnect()}>
          Switch Wallet
        </Button>
      )}
    </div>
  );
}
