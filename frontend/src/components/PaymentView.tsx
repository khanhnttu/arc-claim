"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { NETWORK_NAME } from "@/config/arc";
import { ClaimStatus } from "@/contracts/ArcClaim";
import { usePayment } from "@/hooks/usePayment";
import { useCancelClaim, useClaimPayment, useRefundExpired } from "@/hooks/usePaymentActions";
import { formatUsdc, sameAddress } from "@/lib/format";
import { isV2Enabled, paymentLabel, resendHref, type PaymentData, type PaymentRef } from "@/lib/payments";
import { NotEligible } from "./NotEligible";
import { AddressLink, ExpiryValue, SettlementRows } from "./SettlementDetails";
import { StatusBadge } from "./StatusBadge";
import { TxStatus } from "./TxStatus";
import { WalletButton } from "./WalletButton";
import { Button, Card, DetailRow, Notice, Skeleton, buttonClass } from "./ui";

/** Heading + supporting copy for the viewer (sender or recipient) and the payment's on-chain state. */
function headline(p: PaymentData, isExpired: boolean, viewer: "sender" | "recipient") {
  const amount = `${formatUsdc(p.amount)} USDC`;
  const r = viewer === "recipient";
  switch (p.status) {
    case ClaimStatus.CLAIMED:
      return {
        title: "Payment claimed",
        body: r ? `You received ${amount} from this payment.` : `The recipient received ${amount}.`,
      };
    case ClaimStatus.CANCELLED:
      return {
        title: "Payment cancelled",
        body: r ? "The sender cancelled this payment. Funds returned to the sender." : "Funds returned to you.",
      };
    case ClaimStatus.REFUNDED:
      return {
        title: "Payment expired",
        body: r
          ? "This payment was not claimed before the deadline. Funds returned to the sender."
          : "This payment was not claimed before the deadline. Funds returned to you.",
      };
  }
  if (isExpired) {
    return {
      title: "Payment expired",
      body: r
        ? "This payment was not claimed before the deadline. The remaining USDC can now be returned to the sender."
        : "This payment was not claimed before the deadline. You can now recover the USDC.",
    };
  }
  if (r) {
    return {
      title: "You have a USDC payment",
      body:
        p.expiry === 0n
          ? "This payment is reserved for your wallet. It never expires, so you can claim it any time."
          : "This payment is reserved for your wallet. Claim it before the deadline.",
    };
  }
  return { title: "Payment ready to claim", body: "Your USDC is locked and ready for the recipient to claim." };
}

/** Claim page for a single payment (Phase 1 `/claim/[id]` or ArcClaimV2 `/pay/[id]`). */
export function PaymentView({ paymentRef, rawId }: { paymentRef: PaymentRef | undefined; rawId: string }) {
  const unavailable = paymentRef?.version === 2 && !isV2Enabled;
  const { payment, notFound, isLoading, isError, isExpired, isTerminal, neverExpires, now, refetch } =
    usePayment(unavailable ? undefined : paymentRef);
  const { address, isConnected } = useAccount();

  if (!paymentRef || notFound || unavailable) {
    return (
      <Shell>
        <Card className="p-8 text-center">
          <h1 className="text-xl font-semibold">Payment not found</h1>
          <p className="mt-2 text-sm break-all text-muted">
            There is no ArcClaim payment with ID <span className="font-mono">{rawId}</span>. Check the link you received.
          </p>
          <Link href="/" className={buttonClass({ variant: "secondary", className: "mt-6" })}>
            Create a payment
          </Link>
        </Card>
      </Shell>
    );
  }

  // Payment details are only shown to its sender and recipient. This is a UI courtesy, not access
  // control — payment data is public on-chain; the contract alone decides who can claim or cancel.
  if (!isConnected || !address) {
    return (
      <Shell>
        <Card className="p-8 text-center">
          <h1 className="text-xl font-semibold">Check your eligibility</h1>
          <p className="mt-2 text-sm text-muted">Connect your wallet to see if you can claim this payment.</p>
          <div className="mx-auto mt-6 max-w-xs">
            <WalletButton block />
          </div>
        </Card>
      </Shell>
    );
  }

  if (isError && !payment) {
    return (
      <Shell>
        <Notice tone="error">
          Couldn&apos;t load this payment from {NETWORK_NAME}. Check your connection and{" "}
          <button className="underline" onClick={() => refetch()}>
            try again
          </button>
          .
        </Notice>
      </Shell>
    );
  }

  if (isLoading || !payment) {
    return (
      <Shell>
        <Card className="space-y-4 p-7">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-12 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-12 w-full" />
        </Card>
      </Shell>
    );
  }

  if (!sameAddress(address, payment.recipient) && !sameAddress(address, payment.sender)) {
    return (
      <Shell>
        <NotEligible assignedTo={payment.recipient} connected={address} isSender={false} showAssignee={false} />
      </Shell>
    );
  }

  const amount = `${formatUsdc(payment.amount)} USDC`;
  const viewer = sameAddress(address, payment.recipient) ? "recipient" : "sender";
  const { title, body } = headline(payment, isExpired, viewer);

  return (
    <Shell>
      <Card className="p-5 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm font-medium text-muted" title={paymentRef.id.toString()}>
            Payment {paymentLabel(paymentRef)}
          </p>
          <StatusBadge status={payment.status} expired={isExpired} />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
        <p className="mt-4 text-4xl font-semibold tracking-tight tabular-nums">{amount}</p>

        <dl className="mt-6 divide-y divide-border border-y border-border">
          <DetailRow label="Recipient">
            <AddressLink address={payment.recipient} />
          </DetailRow>
          <DetailRow label="Sender">
            <AddressLink address={payment.sender} />
          </DetailRow>
          {isTerminal ? (
            <SettlementRows paymentRef={paymentRef} status={payment.status} />
          ) : (
            <DetailRow label={isExpired ? "Expired" : "Claim period"}>
              <ExpiryValue expiry={payment.expiry} now={now} />
            </DetailRow>
          )}
        </dl>

        {neverExpires && !isTerminal && (
          <p className="mt-4 text-xs leading-relaxed text-muted">
            This payment does not expire. The recipient can claim at any time, and the sender can cancel before it is
            claimed.
          </p>
        )}

        <div className="mt-6">
          <Actions paymentRef={paymentRef} payment={payment} isExpired={isExpired} amountLabel={amount} />
        </div>
      </Card>
    </Shell>
  );
}

/**
 * The viewer is always the sender or the recipient here (other wallets are gated out above).
 * Recipient: claim. Sender: cancel before expiry, refund after it, resend once settled.
 * Recipients are never offered a refund; the contract lets anyone trigger one, but funds go to the sender.
 */
function Actions({
  paymentRef,
  payment,
  isExpired,
  amountLabel,
}: {
  paymentRef: PaymentRef;
  payment: PaymentData;
  isExpired: boolean;
  amountLabel: string;
}) {
  const { address } = useAccount();
  const claimTx = useClaimPayment();
  const cancelTx = useCancelClaim();
  const refundTx = useRefundExpired();
  const lastTx = [claimTx, cancelTx, refundTx].find((t) => t.phase !== "idle");
  const busy = claimTx.isBusy || cancelTx.isBusy || refundTx.isBusy;
  const isRecipient = sameAddress(address, payment.recipient);
  const isSender = sameAddress(address, payment.sender);
  const { status } = payment;

  const txLine = lastTx && (
    <TxStatus
      busy={lastTx.isBusy}
      message={lastTx.message}
      error={lastTx.error}
      success={lastTx.successText}
      txHash={lastTx.txHash}
    />
  );

  if (status !== ClaimStatus.FUNDED) {
    return (
      <div className="space-y-3">
        {lastTx?.phase === "success" && txLine}
        {isSender && <ResendLink payment={payment} />}
      </div>
    );
  }

  // Only payments with a deadline can expire; never-expire payments skip this entirely.
  if (isExpired) {
    return (
      <div className="space-y-3">
        {txLine}
        {isSender && (
          <Button size="lg" className="w-full" loading={refundTx.isBusy} onClick={() => refundTx.run(paymentRef)}>
            Refund {amountLabel}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {txLine}
      {isRecipient && (
        <Button
          size="lg"
          className="w-full"
          loading={claimTx.isBusy}
          disabled={busy}
          onClick={() => claimTx.run(paymentRef)}
        >
          Claim {amountLabel}
        </Button>
      )}
      {isSender && (
        <Button
          variant="secondary"
          className="w-full"
          loading={cancelTx.isBusy}
          disabled={busy}
          onClick={() => cancelTx.run(paymentRef)}
        >
          Cancel payment
        </Button>
      )}
    </div>
  );
}

/** "Resend" opens the create form pre-filled; it never modifies this payment. */
export function ResendLink({ payment, compact }: { payment: PaymentData; compact?: boolean }) {
  return (
    <Link
      href={resendHref(payment, formatUsdc(payment.amount).replace(/,/g, ""))}
      className={buttonClass({ variant: "secondary", size: compact ? "sm" : "md", className: compact ? "" : "w-full" })}
      title="Create a new payment pre-filled with this recipient and amount"
    >
      Resend
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-lg">{children}</div>;
}
