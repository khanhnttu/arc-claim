"use client";

import type { Address } from "viem";
import { explorerAddressUrl, explorerTxUrl } from "@/config/arc";
import { ClaimStatus } from "@/contracts/ArcClaim";
import { useSettlement } from "@/hooks/useSettlement";
import { formatDateTime, formatExpiry, shortAddress } from "@/lib/format";
import type { PaymentRef } from "@/lib/payments";
import { useNetwork } from "./NetworkProvider";
import { DetailRow, Skeleton } from "./ui";

const LABELS: Record<number, { who: string; when: string }> = {
  [ClaimStatus.CLAIMED]: { who: "Claimed by", when: "Claimed at" },
  [ClaimStatus.CANCELLED]: { who: "Returned to", when: "Cancelled at" },
  [ClaimStatus.REFUNDED]: { who: "Refunded to", when: "Refunded at" },
};

/**
 * Detail rows for a settled payment (who received the USDC, when, and the tx),
 * sourced from the on-chain claim / cancel / refund event. Renders nothing while FUNDED.
 */
export function SettlementRows({
  paymentRef,
  status,
  fromBlockHint,
}: {
  paymentRef: PaymentRef;
  status: number;
  fromBlockHint?: bigint;
}) {
  const labels = LABELS[status];
  const network = useNetwork();
  const { data, isLoading, isError } = useSettlement(paymentRef, status, fromBlockHint);
  if (!labels) return null;

  if (isLoading) {
    return (
      <DetailRow label={labels.who}>
        <Skeleton className="h-4 w-24" />
      </DetailRow>
    );
  }
  if (isError || !data) {
    return (
      <DetailRow label="Transaction">
        <span className="font-normal text-muted">Details unavailable right now</span>
      </DetailRow>
    );
  }

  return (
    <>
      <DetailRow label={labels.who}>
        <AddressLink address={data.account} />
      </DetailRow>
      <DetailRow label={labels.when}>{data.timestamp ? formatDateTime(data.timestamp) : "—"}</DetailRow>
      <DetailRow label="Transaction">
        <a href={explorerTxUrl(network, data.txHash)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          View Transaction ↗
        </a>
      </DetailRow>
    </>
  );
}

/** One-line settlement summary for dense lists (Activity rows). */
export function SettlementLine({
  paymentRef,
  status,
  fromBlockHint,
}: {
  paymentRef: PaymentRef;
  status: number;
  fromBlockHint?: bigint;
}) {
  const labels = LABELS[status];
  const network = useNetwork();
  const { data, isLoading } = useSettlement(paymentRef, status, fromBlockHint);
  if (!labels) return null;
  if (isLoading) return <Skeleton className="h-4 w-56" />;
  if (!data) return null;

  const claimed = status === ClaimStatus.CLAIMED;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span>
        {claimed ? (
          <>
            Claimed by <AddressLink address={data.account} />
          </>
        ) : (
          "Funds returned"
        )}
      </span>
      {data.timestamp && (
        <span>
          · {labels.when.replace(" at", "")} {formatDateTime(data.timestamp)}
        </span>
      )}
      <a href={explorerTxUrl(network, data.txHash)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
        View Transaction ↗
      </a>
    </span>
  );
}

/** Expiry as "in 9 minutes · Sep 24, 5:06 PM", or "Never expires". */
export function ExpiryValue({ expiry, now }: { expiry: bigint; now: number }) {
  if (expiry === 0n) return <span>Never expires</span>;
  return (
    <>
      <span className="block">{now > 0 ? formatExpiry(expiry, now) : "…"}</span>
      <span className="block text-xs font-normal text-muted">{formatDateTime(expiry)}</span>
    </>
  );
}

export function AddressLink({ address, className }: { address: Address; className?: string }) {
  const network = useNetwork();
  return (
    <a
      href={explorerAddressUrl(network, address)}
      target="_blank"
      rel="noreferrer"
      title={address}
      className={className ?? "font-mono hover:underline"}
    >
      {shortAddress(address)}
    </a>
  );
}
