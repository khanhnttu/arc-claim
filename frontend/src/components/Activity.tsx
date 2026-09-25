"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import type { Address, Hash } from "viem";
import { useAccount } from "wagmi";
import { explorerAddressUrl, explorerTxUrl } from "@/config/arc";
import { ClaimStatus } from "@/contracts/ArcClaim";
import { ALLOCATION_STATUS_LABEL, AllocationStatus, BatchStatus } from "@/contracts/ArcClaimBatch";
import { useActivityTimeline, useAllocationClaim, useCreationMeta } from "@/hooks/useCreationMeta";
import { useNow } from "@/hooks/useNow";
import { isTerminalStatus } from "@/hooks/usePayment";
import { useCancelClaim, useRefundExpired } from "@/hooks/usePaymentActions";
import { useSettlement } from "@/hooks/useSettlement";
import {
  recordKey,
  useWalletActivity,
  type ActivityItem,
  type AirdropClaimActivity,
  type AirdropCreatedActivity,
  type PaymentActivity,
} from "@/hooks/useWalletActivity";
import { batchPath, batchPhase, claimedPercent } from "@/lib/batches";
import { formatDateTime, formatExpiry, formatUsdc, shortAddress } from "@/lib/format";
import { isPaymentExpired, paymentPath, paymentUrl } from "@/lib/payments";
import { CopyButton } from "./CopyButton";
import { useNetwork } from "./NetworkProvider";
import { ResendLink } from "./PaymentView";
import { SettlementLine } from "./SettlementDetails";
import { LabelBadge, StatusBadge } from "./StatusBadge";
import { TxStatus } from "./TxStatus";
import { WalletButton } from "./WalletButton";
import { Button, Card, Notice, Pagination, Skeleton, Spinner, buttonClass, cn, paginate } from "./ui";

const PAGE_SIZE = 10;

const FILTERS = [
  { id: "all", label: "All", empty: "No activity yet." },
  { id: "sent", label: "Sent", empty: "No sent payments yet." },
  { id: "received", label: "Received", empty: "No received payments yet." },
  { id: "airdrops", label: "Airdrops", empty: "No airdrop activity yet." },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const MATCHES: Record<Filter, (it: ActivityItem) => boolean> = {
  all: () => true,
  sent: (it) => it.type === "PAYMENT_SENT" || it.type === "AIRDROP_CREATED",
  received: (it) => it.type === "PAYMENT_RECEIVED" || it.type === "AIRDROP_CLAIMED",
  airdrops: (it) => it.type === "AIRDROP_CREATED" || it.type === "AIRDROP_CLAIMED",
};

export function Activity() {
  const { address, isConnected } = useAccount();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Activity</h1>
          <p className="mt-1 text-sm text-muted">Your recent payments and airdrops</p>
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
            See the payments and airdrops you sent or received, and recover unclaimed funds.
          </p>
          <div className="mx-auto mt-5 max-w-xs">
            <WalletButton block />
          </div>
        </Card>
      ) : (
        <ActivityFeed wallet={address} />
      )}
    </div>
  );
}

function ActivityFeed({ wallet }: { wallet: Address }) {
  const network = useNetwork();
  const { data, isLoading, error, refetch } = useWalletActivity(wallet);
  const items = useMemo(() => data ?? [], [data]);
  const timeline = useActivityTimeline(items);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);

  // Newest first by creation block. Records not placed yet (just created) sort to the top.
  const sorted = useMemo(() => {
    const at = (it: ActivityItem) => timeline.blocks.get(recordKey(it.kind, it.nonce));
    return items.filter(MATCHES[filter]).sort((a, b) => {
      const ba = at(a);
      const bb = at(b);
      if (ba !== bb) {
        if (ba === undefined) return -1;
        if (bb === undefined) return 1;
        return ba > bb ? -1 : 1;
      }
      return a.nonce > b.nonce ? -1 : a.nonce < b.nonce ? 1 : a.key < b.key ? -1 : 1;
    });
  }, [items, filter, timeline.blocks]);
  const { pages, current, visible } = paginate(sorted, page, PAGE_SIZE);
  const empty = FILTERS.find((f) => f.id === filter)!.empty;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter activity" className="inline-flex rounded-xl border border-border bg-surface p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setPage(0);
              }}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                filter === f.id ? "bg-surface-2 font-medium text-fg" : "text-muted hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {timeline.isResolving && (
          <span className="flex items-center gap-2 text-xs text-muted">
            <Spinner className="h-3 w-3" /> Sorting by date…
          </span>
        )}
      </div>

      {isLoading ? (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner />
            Loading your activity…
          </div>
          <div className="mt-4 space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </Card>
      ) : error && items.length === 0 ? (
        <Notice tone="error">
          Couldn&apos;t load activity from {network.displayName}.{" "}
          <button className="underline" onClick={() => refetch()}>
            Try again
          </button>
        </Notice>
      ) : sorted.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">{empty}</Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {visible.map((it) => (
              <ActivityRow
                key={it.key}
                item={it}
                wallet={wallet}
                block={timeline.blocks.get(recordKey(it.kind, it.nonce))}
                timelineFailed={timeline.isError}
              />
            ))}
          </ul>
          <Pagination
            page={current}
            pages={pages}
            total={sorted.length}
            noun="items"
            onPage={setPage}
            className="border-t border-border px-5 py-3"
          />
        </Card>
      )}
    </section>
  );
}

/**
 * Rows resolve their tx links once the timeline has placed their record (`block` known), which leaves a
 * single-block log query. Only if the timeline fails does a row fall back to searching on its own.
 */
function ActivityRow({
  item,
  wallet,
  block,
  timelineFailed,
}: {
  item: ActivityItem;
  wallet: Address;
  block?: bigint;
  timelineFailed: boolean;
}) {
  const ready = block !== undefined || timelineFailed;
  switch (item.type) {
    case "PAYMENT_SENT":
      return <PaymentSentRow item={item} wallet={wallet} block={block} ready={ready} />;
    case "PAYMENT_RECEIVED":
      return <PaymentReceivedRow item={item} block={block} ready={ready} />;
    case "AIRDROP_CREATED":
      return <AirdropCreatedRow item={item} block={block} ready={ready} />;
    case "AIRDROP_CLAIMED":
      return <AirdropClaimRow item={item} wallet={wallet} block={block} ready={ready} />;
  }
}

type RowProps<T> = { item: T; block?: bigint; ready: boolean };

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function Row({
  title,
  href,
  amount,
  tone,
  who,
  when,
  badge,
  children,
}: {
  title: string;
  href: string;
  amount: string;
  tone: "out" | "in" | "neutral";
  who?: ReactNode;
  when?: bigint;
  badge: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={href} className="font-medium hover:underline">
            {title}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            {who}
            {when !== undefined && (
              <>
                {who && <span aria-hidden>·</span>}
                <span>{formatDateTime(when)}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={cn(
              "text-base font-semibold tabular-nums",
              tone === "in" && "text-success",
              tone === "neutral" && "text-muted",
            )}
          >
            {amount}
          </span>
          {badge}
        </div>
      </div>
      {children}
    </li>
  );
}

function Counterparty({ label, address }: { label: string; address: Address }) {
  const network = useNetwork();
  return (
    <span>
      {label}{" "}
      <a
        href={explorerAddressUrl(network, address)}
        target="_blank"
        rel="noreferrer"
        title={address}
        className="font-mono hover:text-fg"
      >
        {shortAddress(address)}
      </a>
    </span>
  );
}

/** Explorer link for a lazily resolved tx: "Resolving…", the link, or "unavailable · Retry". */
function TxLink({
  label,
  hash,
  loading,
  failed,
  onRetry,
}: {
  label: string;
  hash?: Hash;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const network = useNetwork();
  if (hash)
    return (
      <a href={explorerTxUrl(network, hash)} target="_blank" rel="noreferrer" className="hover:text-fg">
        {label} ↗
      </a>
    );
  if (failed && !loading)
    return (
      <span>
        Transaction unavailable ·{" "}
        <button type="button" className="underline hover:text-fg" onClick={onRetry}>
          Retry
        </button>
      </span>
    );
  return <span>{label}: Resolving…</span>;
}

const signed = (sign: "-" | "+" | "", amount: bigint) => `${sign === "-" ? "−" : sign}${formatUsdc(amount)} USDC`;

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

function PaymentSentRow({ item, wallet, block, ready }: RowProps<PaymentActivity> & { wallet: Address }) {
  const network = useNetwork();
  const now = useNow();
  const cancelTx = useCancelClaim();
  const refundTx = useRefundExpired();
  const active = [cancelTx, refundTx].find((t) => t.phase !== "idle");
  const { ref, payment } = item;
  const { status } = payment;
  const expired = isPaymentExpired(payment.expiry, now);
  const returned = status === ClaimStatus.CANCELLED || status === ClaimStatus.REFUNDED;
  const creation = useCreationMeta(item.kind, item.nonce, block, ready);

  return (
    <Row
      title="Payment sent"
      href={paymentPath(ref)}
      amount={signed(returned ? "" : "-", payment.amount)}
      tone={returned ? "neutral" : "out"}
      who={<Counterparty label="To" address={item.counterparty} />}
      when={creation.data?.timestamp}
      badge={<StatusBadge status={status} expired={expired} />}
    >
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {!isTerminalStatus(status) && payment.expiry !== 0n && now > 0 && (
          <span className={expired ? "text-warning" : undefined}>{formatExpiry(payment.expiry, now)}</span>
        )}
        {status === ClaimStatus.FUNDED && payment.expiry === 0n && <span>Never expires</span>}
        {returned && <span>Returned to you</span>}
        {status === ClaimStatus.FUNDED && !expired && (
          <CopyButton value={paymentUrl(network, ref)} label="Copy claim link" variant="ghost" className="-ml-3 h-7! text-xs" />
        )}
        {isTerminalStatus(status) && ready && <SettlementLine paymentRef={ref} status={status} fromBlockHint={block} />}
        <TxLink
          label="Transaction"
          hash={creation.data?.txHash}
          loading={creation.isFetching}
          failed={creation.isError}
          onRetry={() => creation.refetch()}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {status === ClaimStatus.FUNDED ? (
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
          <ResendLink payment={{ ...payment, sender: wallet }} compact />
        )}
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
    </Row>
  );
}

function PaymentReceivedRow({ item, block, ready }: RowProps<PaymentActivity>) {
  const now = useNow();
  const { ref, payment } = item;
  const { status } = payment;
  const expired = isPaymentExpired(payment.expiry, now);
  const claimed = status === ClaimStatus.CLAIMED;
  // Claimed: the claim tx (and its time). Otherwise: when the payment was sent to this wallet.
  const settlement = useSettlement(claimed && ready ? ref : undefined, status, block);
  const showCreation = !claimed;
  const creation = useCreationMeta(item.kind, item.nonce, block, showCreation && ready);

  return (
    <Row
      title={
        claimed
          ? "Payment received"
          : status === ClaimStatus.CANCELLED
            ? "Payment cancelled"
            : status === ClaimStatus.REFUNDED || expired
              ? "Payment expired"
              : "Payment to claim"
      }
      href={paymentPath(ref)}
      amount={signed(claimed ? "+" : "", payment.amount)}
      tone={claimed ? "in" : "neutral"}
      who={<Counterparty label="From" address={item.counterparty} />}
      when={claimed ? settlement.data?.timestamp : creation.data?.timestamp}
      badge={<StatusBadge status={status} expired={expired} />}
    >
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {status === ClaimStatus.FUNDED && (
          <span className={expired ? "text-warning" : undefined}>
            {payment.expiry === 0n ? "Never expires" : now > 0 ? formatExpiry(payment.expiry, now) : ""}
          </span>
        )}
        {status === ClaimStatus.CANCELLED && <span>Cancelled by the sender</span>}
        {status === ClaimStatus.REFUNDED && <span>Expired · returned to the sender</span>}
        {claimed ? (
          <TxLink
            label="Claim transaction"
            hash={settlement.data?.txHash}
            loading={settlement.isFetching}
            failed={settlement.isError || (settlement.isSuccess && !settlement.data)}
            onRetry={() => settlement.refetch()}
          />
        ) : (
          showCreation && (
            <TxLink
              label="Transaction"
              hash={creation.data?.txHash}
              loading={creation.isFetching}
              failed={creation.isError}
              onRetry={() => creation.refetch()}
            />
          )
        )}
      </div>
      {status === ClaimStatus.FUNDED && !expired && (
        <div className="mt-3 flex justify-end">
          <Link href={paymentPath(ref)} className={buttonClass({ size: "sm" })}>
            Claim {formatUsdc(payment.amount)} USDC
          </Link>
        </div>
      )}
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Airdrops
// ---------------------------------------------------------------------------

function AirdropCreatedRow({ item, block, ready }: RowProps<AirdropCreatedActivity>) {
  const now = useNow();
  const { batch: b } = item;
  const phase = batchPhase(b, now);
  const creation = useCreationMeta("batch", item.nonce, block, ready);

  return (
    <Row
      title="Airdrop created"
      href={batchPath(item.batchId)}
      amount={`${formatUsdc(b.totalAmount)} USDC`}
      tone="neutral"
      who={
        <span>
          {b.recipientCount.toLocaleString()} recipient{b.recipientCount === 1n ? "" : "s"} ·{" "}
          {b.claimedCount.toString()} claimed ({claimedPercent(b)}%)
        </span>
      }
      when={creation.data?.timestamp}
      badge={<LabelBadge label={phase} />}
    >
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {b.returnedAmount > 0n && <span>{formatUsdc(b.returnedAmount)} USDC returned to you</span>}
        <Link href={batchPath(item.batchId)} className="hover:text-fg">
          View airdrop →
        </Link>
        <TxLink
          label="Transaction"
          hash={creation.data?.txHash}
          loading={creation.isFetching}
          failed={creation.isError}
          onRetry={() => creation.refetch()}
        />
      </div>
    </Row>
  );
}

function AirdropClaimRow({ item, wallet, block, ready }: RowProps<AirdropClaimActivity> & { wallet: Address }) {
  const now = useNow();
  const { batch: b, allocation } = item;
  const claimed = allocation.status === AllocationStatus.CLAIMED;
  const funded = allocation.status === AllocationStatus.FUNDED;
  const phase = batchPhase(b, now);
  const expired = funded && phase === "EXPIRED";
  const claim = useAllocationClaim(item.batchId, wallet, claimed && ready, block);
  const creation = useCreationMeta("batch", item.nonce, block, !claimed && ready);

  return (
    <Row
      title={claimed ? "Airdrop claimed" : funded && !expired && b.status === BatchStatus.ACTIVE ? "Airdrop to claim" : "Airdrop allocation"}
      href={batchPath(item.batchId)}
      amount={signed(claimed ? "+" : "", allocation.amount)}
      tone={claimed ? "in" : "neutral"}
      who={<Counterparty label="From" address={item.counterparty} />}
      when={claimed ? claim.data?.timestamp : creation.data?.timestamp}
      badge={<LabelBadge label={expired ? "EXPIRED" : ALLOCATION_STATUS_LABEL[allocation.status]} />}
    >
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {!claimed && !funded && <span>Returned to the sender</span>}
        <Link href={batchPath(item.batchId)} className="hover:text-fg">
          View airdrop →
        </Link>
        {claimed ? (
          <TxLink
            label="Claim transaction"
            hash={claim.data?.txHash}
            loading={claim.isFetching}
            failed={claim.isError}
            onRetry={() => claim.refetch()}
          />
        ) : (
          <TxLink
            label="Transaction"
            hash={creation.data?.txHash}
            loading={creation.isFetching}
            failed={creation.isError}
            onRetry={() => creation.refetch()}
          />
        )}
      </div>
      {funded && !expired && b.status === BatchStatus.ACTIVE && (
        <div className="mt-3 flex justify-end">
          <Link href={batchPath(item.batchId)} className={buttonClass({ size: "sm" })}>
            Claim {formatUsdc(allocation.amount)} USDC
          </Link>
        </div>
      )}
    </Row>
  );
}
