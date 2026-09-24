"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { NETWORK_NAME } from "@/config/arc";
import { BatchStatus } from "@/contracts/ArcClaimBatch";
import { useBatchClosure, useSenderBatches, type SentBatch } from "@/hooks/useBatches";
import { useNow } from "@/hooks/useNow";
import {
  batchLabel,
  batchPath,
  batchPhase,
  batchTimingText,
  claimedPercent,
  isBatchEnabled,
  type BatchData,
} from "@/lib/batches";
import { formatUsdc } from "@/lib/format";
import { LabelBadge } from "./StatusBadge";
import { Card, Notice, Skeleton, Spinner, cn } from "./ui";

/** The connected sender's airdrops with live progress. */
export function AirdropList({ title = "Your airdrops" }: { title?: string }) {
  const { address } = useAccount();
  const { batches, isLoading, error, progress } = useSenderBatches(address);

  if (!isBatchEnabled || !address) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {isLoading ? (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner />
            {progress
              ? `Scanning blocks… ${Math.round((progress.done / progress.total) * 100)}%`
              : "Loading your airdrops…"}
          </div>
          <Skeleton className="mt-4 h-16 w-full" />
        </Card>
      ) : error ? (
        <Notice tone="error">Couldn&apos;t load your airdrops from {NETWORK_NAME}.</Notice>
      ) : batches.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">No airdrops yet. Create one from the Airdrop page.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {batches.map((b) => (
            <AirdropCard key={b.batchId} batch={b} />
          ))}
        </div>
      )}
    </section>
  );
}

function AirdropCard({ batch }: { batch: SentBatch & { data?: BatchData } }) {
  const now = useNow();
  const d = batch.data;
  const closure = useBatchClosure(batch.batchId, d?.status, batch.blockNumber);

  return (
    <Link
      href={batchPath(batch.batchId)}
      className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <Card className="h-full p-5 transition-colors hover:bg-surface-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-sm text-muted" title={batch.batchId}>
            Airdrop #{batchLabel(batch.batchId)}
          </span>
          <LabelBadge label={d && batchPhase(d, now)} />
        </div>

        {d ? <CardBody data={d} now={now} closedAt={closure.data?.timestamp} /> : <Skeleton className="mt-4 h-28 w-full" />}
      </Card>
    </Link>
  );
}

function CardBody({ data: d, now, closedAt }: { data: BatchData; now: number; closedAt?: bigint }) {
  const phase = batchPhase(d, now);
  const pct = claimedPercent(d);
  const closed = d.status === BatchStatus.REFUNDED || d.status === BatchStatus.CANCELLED;
  const remaining = d.totalAmount - d.claimedAmount;

  return (
    <>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{formatUsdc(d.totalAmount)} USDC</p>
      <p className="text-sm text-muted">
        {d.recipientCount.toLocaleString()} recipient{d.recipientCount === 1n ? "" : "s"}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Claimed</dt>
          <dd className="font-medium tabular-nums">{formatUsdc(d.claimedAmount)} USDC</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{closed ? "Returned" : "Remaining"}</dt>
          <dd className="font-medium tabular-nums">{formatUsdc(closed ? d.returnedAmount : remaining)} USDC</dd>
        </div>
      </dl>

      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="font-medium tabular-nums">
            {d.claimedCount.toString()} / {d.recipientCount.toString()} claimed
          </span>
          <span className="text-muted tabular-nums">{pct}%</span>
        </div>
        <ProgressBar pct={pct} muted={closed} />
      </div>

      <p className={cn("mt-4 text-xs", phase === "EXPIRED" ? "text-warning" : "text-muted")}>
        {batchTimingText(d, phase, now, closedAt)}
      </p>
    </>
  );
}

export function ProgressBar({ pct, className, muted }: { pct: number; className?: string; muted?: boolean }) {
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full transition-[width]", muted ? "bg-muted/60" : "bg-success")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
