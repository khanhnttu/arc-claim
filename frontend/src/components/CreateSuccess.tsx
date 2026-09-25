"use client";

import Link from "next/link";
import { explorerTxUrl } from "@/config/arc";
import { ClaimStatus } from "@/contracts/ArcClaim";
import type { CreatedPayment } from "@/hooks/useCreatePayment";
import { usePayment } from "@/hooks/usePayment";
import { formatUsdc, shortAddress } from "@/lib/format";
import { paymentLabel, paymentPath, paymentUrl } from "@/lib/payments";
import { CopyButton } from "./CopyButton";
import { useNetwork } from "./NetworkProvider";
import { ExpiryValue, SettlementRows } from "./SettlementDetails";
import { StatusBadge } from "./StatusBadge";
import { Button, Card, DetailRow, buttonClass, cn } from "./ui";

type Tone = "waiting" | "success" | "neutral" | "warning";

/** Heading + subtitle for each on-chain state. */
function headline(status: number | undefined, expired: boolean): { title: string; body: string; tone: Tone } {
  switch (status) {
    case ClaimStatus.CLAIMED:
      return { title: "Payment claimed", body: "The recipient has claimed this payment.", tone: "success" };
    case ClaimStatus.CANCELLED:
      return { title: "Payment cancelled", body: "The USDC was returned to the sender.", tone: "neutral" };
    case ClaimStatus.REFUNDED:
      return {
        title: "Payment refunded",
        body: "The payment expired and the USDC was returned to the sender.",
        tone: "neutral",
      };
    default:
      return expired
        ? {
            title: "Payment expired",
            body: "It was not claimed before the deadline. Recover the USDC from Activity.",
            tone: "warning",
          }
        : {
            title: "Payment ready to claim",
            body: "Your USDC is locked and ready for the recipient to claim.",
            tone: "waiting",
          };
  }
}

export function CreateSuccess({ result, onReset }: { result: CreatedPayment; onReset: () => void }) {
  // Live on-chain state; polls every few seconds until the payment is settled.
  const { payment, isExpired, isTerminal, now } = usePayment(result.ref);
  const status = payment?.status ?? ClaimStatus.FUNDED;
  const { title, body, tone } = headline(payment?.status, isExpired);
  const network = useNetwork();
  const link = paymentUrl(network, result.ref);

  return (
    <Card className="p-5 sm:p-7">
      <div className="flex items-start gap-3">
        <StatusIcon tone={tone} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-muted">{body}</p>
        </div>
      </div>

      <dl className="mt-6 divide-y divide-border border-y border-border">
        <DetailRow label="Status">
          <span className="inline-flex items-center gap-2">
            {!isTerminal && (
              <span className="text-xs font-normal text-muted" title="Checking the chain every few seconds">
                Live
              </span>
            )}
            <StatusBadge status={status} expired={isExpired} />
          </span>
        </DetailRow>
        <DetailRow label="Amount">
          <span className="text-base tabular-nums">{formatUsdc(payment?.amount ?? result.amount)} USDC</span>
        </DetailRow>
        <DetailRow label="Recipient">
          <span className="font-mono" title={result.recipient}>
            {shortAddress(result.recipient)}
          </span>
        </DetailRow>
        <DetailRow label="Payment ID">
          <span className="font-mono" title={result.ref.id.toString()}>
            {paymentLabel(result.ref)}
          </span>
        </DetailRow>
        {isTerminal ? (
          <SettlementRows paymentRef={result.ref} status={status} fromBlockHint={result.blockNumber} />
        ) : (
          <DetailRow label={isExpired ? "Expired" : "Claim period"}>
            <ExpiryValue expiry={payment?.expiry ?? result.expiry} now={now} />
          </DetailRow>
        )}
      </dl>

      {!isTerminal && !isExpired && (
        <div className="mt-6 space-y-2">
          <label className="text-sm font-medium" htmlFor="claim-link">
            Claim link
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="claim-link"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 font-mono text-xs"
            />
            <CopyButton value={link} label="Copy Claim Link" variant="primary" />
          </div>
          <p className="text-xs text-muted">
            The link is not a secret — only the recipient&apos;s wallet can claim this payment.
          </p>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <a
          href={explorerTxUrl(network, result.txHash)}
          target="_blank"
          rel="noreferrer"
          className={buttonClass({ variant: "secondary", className: "flex-1" })}
        >
          Creation tx ↗
        </a>
        <Link
          href={isExpired && !isTerminal ? "/activity" : paymentPath(result.ref)}
          className={buttonClass({ variant: "secondary", className: "flex-1" })}
        >
          {isExpired && !isTerminal ? "Go to Activity" : "Open claim page"}
        </Link>
        <Button variant="ghost" className="flex-1" onClick={onReset}>
          Create another
        </Button>
      </div>
    </Card>
  );
}

function StatusIcon({ tone }: { tone: Tone }) {
  return (
    <span
      className={cn(
        "grid h-10 w-10 shrink-0 place-items-center rounded-full",
        tone === "success" && "bg-success-bg text-success",
        tone === "waiting" && "bg-info-bg text-accent",
        tone === "neutral" && "bg-surface-2 text-muted",
        tone === "warning" && "bg-warning-bg text-warning",
      )}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
        {tone === "success" && <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />}
        {tone === "waiting" && (
          <>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 8v4l2.5 2" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {tone === "neutral" && (
          <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {tone === "warning" && (
          <path d="M12 8v5M12 16.5v.5M12 3 2 20h20L12 3Z" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </span>
  );
}
