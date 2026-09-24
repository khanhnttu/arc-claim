"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { NETWORK_NAME } from "@/config/arc";
import { explorerAddressUrl, explorerTxUrl } from "@/config/arc";
import { ClaimStatus } from "@/contracts/ArcClaim";
import { useNow } from "@/hooks/useNow";
import { isTerminalStatus } from "@/hooks/usePayment";
import { useCancelClaim, useRefundExpired } from "@/hooks/usePaymentActions";
import { useSenderPayments, type SentPayment } from "@/hooks/useSenderPayments";
import { formatDateTime, formatExpiry, formatUsdc, shortAddress } from "@/lib/format";
import { isPaymentExpired, isV1Enabled, isV2Enabled, paymentLabel, paymentPath, paymentUrl, refKey } from "@/lib/payments";
import { CopyButton } from "./CopyButton";
import { AirdropList } from "./AirdropList";
import { ResendLink } from "./PaymentView";
import { SettlementLine } from "./SettlementDetails";
import { StatusBadge } from "./StatusBadge";
import { TxStatus } from "./TxStatus";
import { WalletButton } from "./WalletButton";
import { Button, Card, Notice, Skeleton, Spinner, buttonClass } from "./ui";

export function Dashboard() {
  const { address, isConnected } = useAccount();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Your payments and airdrops, read directly from Arc.</p>
        </div>
        {isConnected && (
          <div className="flex gap-2">
            <Link href="/airdrop" className={buttonClass({ variant: "secondary" })}>
              Create Airdrop
            </Link>
            <Link href="/" className={buttonClass()}>
              Send Payment
            </Link>
          </div>
        )}
      </div>

      {!isConnected || !address ? (
        <Card className="p-8 text-center">
          <h2 className="font-semibold">Connect your wallet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Connect the wallet you sent from to track claims and recover unclaimed funds.
          </p>
          <div className="mx-auto mt-5 max-w-xs">
            <WalletButton block />
          </div>
        </Card>
      ) : (
        <>
          <section className="space-y-6">
            <h2 className="text-lg font-semibold tracking-tight">Payments</h2>
            {isV2Enabled && <PaymentSection version={2} sender={address} />}
            {isV1Enabled && (
              <PaymentSection
                version={1}
                sender={address}
                title={isV2Enabled ? "Earlier payments" : undefined}
                subtitle={isV2Enabled ? "Sent with the original ArcClaim contract." : undefined}
              />
            )}
          </section>
          <AirdropList title="Airdrops" />
        </>
      )}
    </div>
  );
}

function PaymentSection({
  version,
  sender,
  title,
  subtitle,
}: {
  version: 1 | 2;
  sender: Address;
  title?: string;
  subtitle?: string;
}) {
  const { payments, isLoading, error, progress, refetch } = useSenderPayments(version, sender);
  const now = useNow();
  const locked = payments
    .filter((p) => p.status === ClaimStatus.FUNDED)
    .reduce((sum, p) => sum + p.amount, 0n);

  return (
    <section className="space-y-3">
      {title && (
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      )}

      {isLoading ? (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner />
            {progress
              ? `Scanning blocks for your payments… ${Math.round((progress.done / progress.total) * 100)}%`
              : "Loading your payments…"}
          </div>
          <div className="mt-4 space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        </Card>
      ) : error && payments.length === 0 ? (
        <Notice tone="error">
          Couldn&apos;t load payments from {NETWORK_NAME}.{" "}
          <button className="underline" onClick={() => refetch()}>
            Try again
          </button>
        </Notice>
      ) : payments.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">No payments yet.</Card>
      ) : (
        <>
          <p className="text-sm text-muted">
            {payments.length} payment{payments.length === 1 ? "" : "s"} ·{" "}
            <span className="font-medium text-fg tabular-nums">{formatUsdc(locked)} USDC</span> currently locked
          </p>
          <Card className="overflow-hidden">
            <div className="hidden grid-cols-[7rem_1fr_8rem_11rem_7rem_10rem] gap-4 border-b border-border bg-surface-2 px-5 py-3 text-xs font-medium tracking-wide text-muted uppercase md:grid">
              <span>ID</span>
              <span>Recipient</span>
              <span className="text-right">Amount</span>
              <span>Expiry</span>
              <span>Status</span>
              <span className="text-right">Actions</span>
            </div>
            <ul className="divide-y divide-border">
              {payments.map((p) => (
                <PaymentRow key={refKey(p.ref)} payment={p} sender={sender} now={now} />
              ))}
            </ul>
          </Card>
        </>
      )}
    </section>
  );
}

function PaymentRow({
  payment,
  sender,
  now,
}: {
  payment: SentPayment & { status?: number };
  sender: Address;
  now: number;
}) {
  const cancelTx = useCancelClaim();
  const refundTx = useRefundExpired();
  const active = [cancelTx, refundTx].find((t) => t.phase !== "idle");
  const expired = isPaymentExpired(payment.expiry, now);
  const { ref, status } = payment;

  return (
    <li className="px-5 py-4">
      <div className="grid grid-cols-2 items-center gap-x-4 gap-y-2 md:grid-cols-[7rem_1fr_8rem_11rem_7rem_10rem]">
        <Link
          href={paymentPath(ref)}
          className="truncate font-mono text-sm font-medium hover:underline"
          title={ref.id.toString()}
        >
          {paymentLabel(ref)}
        </Link>
        <div className="justify-self-end md:hidden">
          <StatusBadge status={status} expired={expired} />
        </div>

        <a
          href={explorerAddressUrl(payment.recipient)}
          target="_blank"
          rel="noreferrer"
          title={payment.recipient}
          className="font-mono text-sm text-muted hover:text-fg"
        >
          <span className="md:hidden">To </span>
          {shortAddress(payment.recipient)}
        </a>
        <span className="justify-self-end text-sm font-semibold tabular-nums md:text-right">
          {formatUsdc(payment.amount)} USDC
        </span>

        <span className="col-span-2 text-sm md:col-span-1">
          {payment.expiry === 0n ? (
            <span className="block">Never expires</span>
          ) : isTerminalStatus(status) ? (
            // Settled payments: no countdown, just the original deadline for reference.
            <span className="block text-xs text-muted">Deadline {formatDateTime(payment.expiry)}</span>
          ) : (
            <>
              <span className="block">{now > 0 ? formatExpiry(payment.expiry, now) : "…"}</span>
              <span className="block text-xs text-muted">{formatDateTime(payment.expiry)}</span>
            </>
          )}
        </span>
        <span className="hidden md:block">
          <StatusBadge status={status} expired={expired} />
        </span>

        <div className="col-span-2 flex items-center justify-end gap-2 md:col-span-1">
          {status === undefined ? (
            <Skeleton className="h-9 w-20" />
          ) : status === ClaimStatus.FUNDED ? (
            expired ? (
              <Button size="sm" loading={refundTx.isBusy} onClick={() => refundTx.run(ref)}>
                Refund {formatUsdc(payment.amount)} USDC
              </Button>
            ) : (
              <Button size="sm" variant="secondary" loading={cancelTx.isBusy} onClick={() => cancelTx.run(ref)}>
                Cancel
              </Button>
            )
          ) : (
            <>
              <span className="text-sm text-muted">
                {status === ClaimStatus.CLAIMED
                  ? "Claimed"
                  : status === ClaimStatus.CANCELLED
                    ? "Cancelled"
                    : "Refunded"}
              </span>
              <ResendLink payment={{ ...payment, sender, status }} compact />
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {status === ClaimStatus.FUNDED && !expired && (
          <CopyButton value={paymentUrl(ref)} label="Copy claim link" variant="ghost" className="-ml-3 h-7! text-xs" />
        )}
        {isTerminalStatus(status) && (
          <SettlementLine paymentRef={ref} status={status!} fromBlockHint={payment.blockNumber} />
        )}
        <a href={explorerTxUrl(payment.txHash)} target="_blank" rel="noreferrer" className="hover:text-fg">
          Creation tx ↗
        </a>
      </div>

      {active && (
        <div className="mt-3">
          <TxStatus
            busy={active.isBusy}
            message={active.message}
            error={active.error}
            success={active.successText}
            txHash={active.txHash}
          />
        </div>
      )}
    </li>
  );
}
