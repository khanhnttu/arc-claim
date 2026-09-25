"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount } from "wagmi";
import { explorerTxUrl } from "@/config/arc";
import { ALLOCATION_STATUS_LABEL, AllocationStatus, BatchStatus } from "@/contracts/ArcClaimBatch";
import {
  useAllocations,
  useBatch,
  useBatchActivity,
  useCancelBatch,
  useClaimAllocation,
  useMyAllocation,
  useRefundBatch,
  type ClaimRecord,
} from "@/hooks/useBatches";
import { useNow } from "@/hooks/useNow";
import {
  batchLabel,
  batchPhase,
  batchTimingText,
  batchUrl,
  claimedPercent,
  batchContract,
  isBatchSettled,
  type BatchData,
  type BatchPhase,
} from "@/lib/batches";
import { formatDate, formatDateTime, formatUsdc, sameAddress } from "@/lib/format";
import { ProgressBar } from "./AirdropList";
import { CopyButton } from "./CopyButton";
import { useNetwork } from "./NetworkProvider";
import { NotEligible } from "./NotEligible";
import { OtherNetworkHint } from "./NetworkSwitcher";
import { AddressLink, ExpiryValue } from "./SettlementDetails";
import { LabelBadge } from "./StatusBadge";
import { TxStatus } from "./TxStatus";
import { WalletButton } from "./WalletButton";
import { Button, Card, DetailRow, Notice, Pagination, Skeleton, buttonClass } from "./ui";

const PAGE_SIZE = 50;

export function AirdropView({
  batchId,
  rawId,
  justCreated,
}: {
  batchId: Hex | undefined;
  rawId: string;
  justCreated?: boolean;
}) {
  const now = useNow();
  const network = useNetwork();
  const { isBatchEnabled } = batchContract(network);
  const { data, isLoading, isError, refetch } = useBatch(batchId);
  const batch = data as BatchData | undefined;
  const exists = !!batch && batch.status !== BatchStatus.NONE;

  if (!isBatchEnabled || !batchId || (!isLoading && !isError && !exists)) {
    return (
      <Card className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-semibold">Airdrop not found</h1>
        <p className="mt-2 text-sm break-all text-muted">
          There is no ArcClaim airdrop with ID <span className="font-mono">{rawId}</span> on {network.displayName}.
        </p>
        <OtherNetworkHint />
        <Link href="/airdrop" className={buttonClass({ variant: "secondary", className: "mt-6" })}>
          Go to airdrops
        </Link>
      </Card>
    );
  }
  if (isError && !batch) {
    return (
      <Notice tone="error">
        Couldn&apos;t load this airdrop.{" "}
        <button className="underline" onClick={() => refetch()}>
          Try again
        </button>
      </Notice>
    );
  }
  if (!batch) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return <AirdropGate batchId={batchId} batch={batch} now={now} justCreated={justCreated} />;
}

/**
 * Decides what the viewer may see. Only the sender sees totals and the recipient list; a recipient sees
 * just their own allocation; anyone else (or a disconnected visitor) sees only an eligibility message.
 * This is a UI courtesy, not access control: batch data is public on-chain. Non-senders never load the
 * recipient list — eligibility is a single getAllocation(batchId, connectedWallet) read.
 */
function AirdropGate({
  batchId,
  batch,
  now,
  justCreated,
}: {
  batchId: Hex;
  batch: BatchData;
  now: number;
  justCreated?: boolean;
}) {
  const { address, isConnected } = useAccount();
  const settled = isBatchSettled(batch);
  const mine = useMyAllocation(batchId, address, settled);
  const isSender = sameAddress(address, batch.sender);

  if (!isConnected || !address) {
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">Check your eligibility</h1>
        <p className="mt-2 text-sm text-muted">Connect your wallet to see if you can claim from this airdrop.</p>
        <div className="mx-auto mt-6 max-w-xs">
          <WalletButton block />
        </div>
      </Card>
    );
  }

  if (isSender)
    return <AirdropDetails batchId={batchId} batch={batch} now={now} mine={mine} justCreated={justCreated} />;

  if (mine.status === undefined) {
    return (
      <Card className="mx-auto max-w-md space-y-3 p-8">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-12 w-full" />
      </Card>
    );
  }

  if (mine.status === AllocationStatus.NONE) {
    return (
      <div className="mx-auto max-w-md">
        <NotEligible assignedTo={batch.sender} connected={address} isSender={false} what="airdrop" />
      </div>
    );
  }

  // Recipient: only their own allocation, the airdrop status and deadline.
  const phase = batchPhase(batch, now);
  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Airdrop</p>
          <h1 className="font-mono text-xl font-semibold" title={batchId}>
            #{batchLabel(batchId)}
          </h1>
        </div>
        <LabelBadge label={phase} />
      </div>
      <AllocationPanel batchId={batchId} batch={batch} phase={phase} mine={mine} isSender={false} />
      <Card className="px-5">
        <dl className="divide-y divide-border">
          <TimingRow batch={batch} phase={phase} now={now} />
        </dl>
      </Card>
    </div>
  );
}

/** Deadline while the airdrop is open; afterwards, what happened instead of a countdown. */
function TimingRow({
  batch,
  phase,
  now,
  closedAt,
}: {
  batch: BatchData;
  phase: BatchPhase;
  now: number;
  closedAt?: bigint;
}) {
  if (phase === "ACTIVE" || phase === "EXPIRED") {
    return (
      <DetailRow label={phase === "EXPIRED" ? "Expired" : "Expiry"}>
        <ExpiryValue expiry={batch.expiry} now={now} />
      </DetailRow>
    );
  }
  return (
    <DetailRow label={phase === "COMPLETED" ? "Status" : "Funds"}>
      {batchTimingText(batch, phase, now, closedAt)}
    </DetailRow>
  );
}

type MyAllocation = ReturnType<typeof useMyAllocation>;

/** Full sender dashboard: totals, progress and the per-recipient table. */
function AirdropDetails({
  batchId,
  batch,
  now,
  mine,
  justCreated,
}: {
  batchId: Hex;
  batch: BatchData;
  now: number;
  mine: MyAllocation;
  justCreated?: boolean;
}) {
  const network = useNetwork();
  const [showCreated, setShowCreated] = useState(!!justCreated);
  const settled = isBatchSettled(batch);
  const phase = batchPhase(batch, now);
  const activity = useBatchActivity(batchId, settled);
  const recipientAddrs = useMemo(() => activity.recipients.map((r) => r.address), [activity.recipients]);
  const { statuses } = useAllocations(batchId, recipientAddrs, settled);
  const pct = claimedPercent(batch);
  const pending = batch.status === BatchStatus.ACTIVE ? batch.totalAmount - batch.claimedAmount : 0n;

  return (
    <div className="space-y-6">
      {showCreated && (
        <Notice tone="success" className="flex items-start justify-between gap-3">
          <span>Airdrop ready. Copy the link and share it with your recipients.</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="-my-0.5 shrink-0 px-1 opacity-70 hover:opacity-100"
            onClick={() => setShowCreated(false)}
          >
            ✕
          </button>
        </Notice>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Airdrop</p>
          <h1 className="font-mono text-2xl font-semibold tracking-tight" title={batchId}>
            #{batchLabel(batchId)}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <LabelBadge label={phase} />
          <CopyButton value={batchUrl(network, batchId)} label="Copy airdrop link" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="p-5 sm:p-6">
          <p className="text-sm text-muted">Total</p>
          <p className="text-4xl font-semibold tracking-tight tabular-nums">{formatUsdc(batch.totalAmount)} USDC</p>
          <p className="mt-1 text-sm text-muted">{batch.recipientCount.toLocaleString()} recipients</p>

          <ProgressBar pct={pct} className="mt-5" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              label="Claimed"
              value={`${formatUsdc(batch.claimedAmount)} USDC`}
              sub={`${batch.claimedCount} of ${batch.recipientCount}`}
            />
            <Metric label="Pending" value={`${formatUsdc(pending)} USDC`} />
            <Metric label="Progress" value={`${pct}%`} />
            <Metric
              label={batch.status === BatchStatus.CANCELLED ? "Cancelled" : "Refunded"}
              value={`${formatUsdc(batch.returnedAmount)} USDC`}
            />
          </div>

          <dl className="mt-5 divide-y divide-border border-t border-border">
            <DetailRow label="Sender">
              <AddressLink address={batch.sender} />
            </DetailRow>
            <TimingRow batch={batch} phase={phase} now={now} closedAt={activity.closed?.timestamp} />
            {activity.closed && (
              <DetailRow label={activity.closed.event === "BatchRefunded" ? "Refund tx" : "Cancel tx"}>
                <a
                  href={explorerTxUrl(network, activity.closed.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  View Transaction ↗
                </a>
              </DetailRow>
            )}
          </dl>
        </Card>

        <div className="space-y-6">
          <AllocationPanel batchId={batchId} batch={batch} phase={phase} mine={mine} isSender />
          <SenderPanel batchId={batchId} batch={batch} phase={phase} closedAt={activity.closed?.timestamp} />
        </div>
      </div>

      <RecipientsTable
        recipients={activity.recipients}
        statuses={statuses}
        claims={activity.claims}
        loading={activity.isLoading}
        expectedCount={Number(batch.recipientCount)}
      />
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted tabular-nums">{sub}</p>}
    </div>
  );
}

/**
 * Recipient side: claim your own allocation. Never offers a refund — refunds are the sender's
 * business (the contract lets anyone trigger one, but the funds always go to the sender).
 */
function AllocationPanel({
  batchId,
  batch,
  phase,
  mine,
  isSender,
}: {
  batchId: Hex;
  batch: BatchData;
  phase: BatchPhase;
  mine: MyAllocation;
  isSender: boolean;
}) {
  const claimTx = useClaimAllocation();
  if (mine.amount === undefined || mine.status === undefined || mine.status === AllocationStatus.NONE) return null;

  const unclaimed = batch.totalAmount - batch.claimedAmount;
  const returned = batch.status === BatchStatus.REFUNDED || batch.status === BatchStatus.CANCELLED;

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <h2 className="font-semibold">Your allocation</h2>

      {claimTx.phase !== "idle" && (
        <TxStatus
          busy={claimTx.isBusy}
          message={claimTx.message}
          error={claimTx.error}
          success={claimTx.successText}
          txHash={claimTx.txHash}
        />
      )}

      <div className="flex items-center justify-between">
        <span className="text-2xl font-semibold tabular-nums">{formatUsdc(mine.amount)} USDC</span>
        <LabelBadge label={ALLOCATION_STATUS_LABEL[mine.status]} />
      </div>

      {mine.status === AllocationStatus.FUNDED && phase === "ACTIVE" && (
        <Button size="lg" className="w-full" loading={claimTx.isBusy} onClick={() => claimTx.run(batchId)}>
          Claim {formatUsdc(mine.amount)} USDC
        </Button>
      )}
      {mine.status === AllocationStatus.FUNDED && phase === "EXPIRED" && (
        <Notice tone="warning">This airdrop expired before you claimed.</Notice>
      )}
      {mine.status === AllocationStatus.CLAIMED && claimTx.phase !== "success" && (
        <Notice tone="success">
          {!isSender && phase === "EXPIRED" && unclaimed > 0n
            ? "You already claimed your allocation. Any remaining unclaimed funds will be returned to the sender."
            : "You claimed this allocation."}
        </Notice>
      )}
      {(mine.status === AllocationStatus.REFUNDED || mine.status === AllocationStatus.CANCELLED) && (
        <Notice>This allocation was not claimed and was returned to the sender.</Notice>
      )}

      {/* Informational only for recipients: what happens to the rest of the airdrop. */}
      {!isSender && phase === "EXPIRED" && unclaimed > 0n && mine.status !== AllocationStatus.CLAIMED && (
        <p className="text-sm text-muted">
          {formatUsdc(unclaimed)} USDC remains unclaimed and will be returned to the sender.
        </p>
      )}
      {!isSender && returned && batch.returnedAmount > 0n && (
        <p className="text-sm text-muted">
          {formatUsdc(batch.returnedAmount)} USDC that was not claimed has been returned to the sender.
        </p>
      )}
    </Card>
  );
}

/** Sender side: recover unclaimed funds — cancel before expiry, refund after it. */
function SenderPanel({
  batchId,
  batch,
  phase,
  closedAt,
}: {
  batchId: Hex;
  batch: BatchData;
  phase: BatchPhase;
  closedAt?: bigint;
}) {
  const cancelTx = useCancelBatch();
  const refundTx = useRefundBatch();
  const lastTx = [cancelTx, refundTx].find((t) => t.phase !== "idle");
  const busy = cancelTx.isBusy || refundTx.isBusy;
  const unclaimed = batch.totalAmount - batch.claimedAmount;

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <h2 className="font-semibold">Recover unclaimed funds</h2>

      {lastTx && (
        <TxStatus
          busy={lastTx.isBusy}
          message={lastTx.message}
          error={lastTx.error}
          success={lastTx.successText}
          txHash={lastTx.txHash}
        />
      )}

      {phase === "REFUNDED" || phase === "CANCELLED" ? (
        lastTx?.phase !== "success" && (
          <Notice tone="success">
            Funds returned. {formatUsdc(batch.returnedAmount)} USDC of unclaimed funds was recovered to your wallet
            {closedAt ? ` on ${formatDate(closedAt)}` : ""}.
          </Notice>
        )
      ) : phase === "COMPLETED" ? (
        <p className="text-sm text-muted">Every recipient has claimed. There is nothing to recover.</p>
      ) : phase === "EXPIRED" ? (
        <>
          <p className="text-sm text-muted">
            This airdrop has expired. {formatUsdc(unclaimed)} USDC was not claimed. Refund it to recover the
            unclaimed funds to your wallet.
          </p>
          <Button className="w-full" loading={refundTx.isBusy} disabled={busy} onClick={() => refundTx.run(batchId)}>
            Refund {formatUsdc(unclaimed)} USDC
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            {formatUsdc(unclaimed)} USDC is still unclaimed.{" "}
            {batch.expiry === 0n
              ? "This airdrop never expires; cancel it to take the unclaimed USDC back."
              : "It becomes refundable after the deadline, or you can cancel now to take it back."}{" "}
            Claimed allocations are not affected.
          </p>
          <Button
            variant="secondary"
            className="w-full"
            loading={cancelTx.isBusy}
            disabled={busy}
            onClick={() => cancelTx.run(batchId)}
          >
            Cancel airdrop · return {formatUsdc(unclaimed)} USDC
          </Button>
        </>
      )}
    </Card>
  );
}

function RecipientsTable({
  recipients,
  statuses,
  claims,
  loading,
  expectedCount,
}: {
  recipients: { address: Address; amount: bigint }[];
  statuses: Map<string, number>;
  claims: Map<string, ClaimRecord>;
  loading: boolean;
  expectedCount: number;
}) {
  const network = useNetwork();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "FUNDED" | "CLAIMED" | "REFUNDED" | "CANCELLED">("ALL");
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipients.filter((r) => {
      if (q && !r.address.toLowerCase().includes(q)) return false;
      if (filter === "ALL") return true;
      return ALLOCATION_STATUS_LABEL[statuses.get(r.address.toLowerCase()) ?? -1] === filter;
    });
  }, [recipients, statuses, query, filter]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="font-semibold">
          Recipients{" "}
          <span className="font-normal text-muted">
            ({recipients.length.toLocaleString()}
            {recipients.length < expectedCount ? ` of ${expectedCount.toLocaleString()} loaded` : ""})
          </span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Search wallet…"
            className="h-9 w-48 rounded-lg border border-border bg-surface px-3 font-mono text-xs outline-none focus:border-accent"
          />
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as typeof filter);
              setPage(0);
            }}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"
          >
            <option value="ALL">All statuses</option>
            <option value="FUNDED">Funded</option>
            <option value="CLAIMED">Claimed</option>
            <option value="REFUNDED">Refunded</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {loading && recipients.length === 0 ? (
        <div className="space-y-2 p-5">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-surface-2 text-left text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="px-5 py-2.5 font-medium">Wallet</th>
                <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 font-medium">Claimed at</th>
                <th className="px-5 py-2.5 font-medium">Transaction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((r) => {
                const st = statuses.get(r.address.toLowerCase());
                const claim = claims.get(r.address.toLowerCase());
                return (
                  <tr key={r.address}>
                    <td className="px-5 py-2.5">
                      <AddressLink address={r.address} />
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{formatUsdc(r.amount)} USDC</td>
                    <td className="px-5 py-2.5">
                      <LabelBadge label={st === undefined ? undefined : ALLOCATION_STATUS_LABEL[st]} />
                    </td>
                    <td className="px-5 py-2.5 text-muted">
                      {claim?.timestamp ? formatDateTime(claim.timestamp) : "—"}
                    </td>
                    <td className="px-5 py-2.5">
                      {claim ? (
                        <a href={explorerTxUrl(network, claim.txHash)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                          View ↗
                        </a>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted">
                    No recipients match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        pages={pages}
        total={rows.length}
        noun="rows"
        onPage={setPage}
        className="border-t border-border px-5 py-3"
      />
    </Card>
  );
}
