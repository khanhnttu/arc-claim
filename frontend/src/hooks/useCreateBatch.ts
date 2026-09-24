"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { parseEventLogs, type Address, type Hash, type Hex } from "viem";
import { useConfig } from "wagmi";
import { simulateContract, writeContract } from "wagmi/actions";
import { arcChain } from "@/config/arc";
import { MAX_RECIPIENTS_PER_CALL } from "@/contracts/ArcClaimBatch";
import { BATCH } from "@/lib/batches";
import { FriendlyError, toFriendlyMessage } from "@/lib/errors";
import { ensureUsdcAllowance, nowSeconds, refreshChainReads, requireArcAccount, waitForSuccess } from "@/lib/tx";

export type BatchStep =
  | "idle"
  | "checking"
  | "approve-wallet"
  | "approving"
  | "approved"
  | "tx-wallet"
  | "tx-pending"
  | "success"
  | "error";

export type BatchRow = { address: Address; amount: bigint };

export type CreatedBatch = { batchId: Hex; txHashes: Hash[]; blockNumber: bigint; total: bigint; count: number };

type Progress = { batchId?: Hex; done: number; total: number; txHashes: Hash[]; blockNumber?: bigint };

export function chunkRows<T>(rows: T[], size = MAX_RECIPIENTS_PER_CALL): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Create an airdrop: approve exactly the total (if needed), then createBatch for the first
 * 200 rows and addAllocations for each further chunk — all under one batch id.
 * If a later transaction fails, `create` can be called again to resume from the next chunk.
 * The contract recomputes the total and validates every row itself.
 */
export function useCreateBatch() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<BatchStep>("idle");
  const [needsApproval, setNeedsApproval] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<CreatedBatch>();
  const [progress, setProgress] = useState<Progress>({ done: 0, total: 0, txHashes: [] });
  const progressRef = useRef(progress);

  const update = (p: Progress) => {
    progressRef.current = p;
    setProgress(p);
  };

  const reset = useCallback(() => {
    setStep("idle");
    setNeedsApproval(false);
    setError(undefined);
    setResult(undefined);
    update({ done: 0, total: 0, txHashes: [] });
  }, []);

  const create = useCallback(
    async (rows: BatchRow[], expiry: bigint) => {
      setError(undefined);
      const chunks = chunkRows(rows);
      // Resume only if the same airdrop was partially created in this session.
      const prev = progressRef.current;
      const resume = prev.batchId && prev.total === chunks.length ? prev : undefined;
      let p: Progress = resume ?? { done: 0, total: chunks.length, txHashes: [] };
      update(p);

      try {
        if (chunks.length === 0) throw new FriendlyError("Add at least one recipient.");
        if (!resume && expiry !== 0n && expiry <= BigInt(nowSeconds()))
          throw new FriendlyError("Expiration must be in the future.");

        setStep("checking");
        const sender = await requireArcAccount(config);
        const chainId = arcChain.id;
        const remaining = chunks.slice(p.done).flat().reduce((s, r) => s + r.amount, 0n);

        await ensureUsdcAllowance(config, sender, BATCH.address, remaining, (s) => {
          setNeedsApproval(true);
          setStep(s);
        });

        for (let i = p.done; i < chunks.length; i++) {
          const recipients = chunks[i].map((r) => r.address);
          const amounts = chunks[i].map((r) => r.amount);
          setStep("tx-wallet");
          let hash: Hash;
          if (i === 0) {
            const { request } = await simulateContract(config, {
              ...BATCH,
              functionName: "createBatch",
              args: [recipients, amounts, expiry],
              account: sender,
              chainId,
            });
            hash = await writeContract(config, request);
          } else {
            const { request } = await simulateContract(config, {
              ...BATCH,
              functionName: "addAllocations",
              args: [p.batchId!, recipients, amounts],
              account: sender,
              chainId,
            });
            hash = await writeContract(config, request);
          }
          setStep("tx-pending");
          const receipt = await waitForSuccess(config, hash);

          let batchId = p.batchId;
          if (i === 0) {
            const [created] = parseEventLogs({
              abi: BATCH.abi,
              eventName: "BatchCreated",
              logs: receipt.logs.filter((l) => l.address.toLowerCase() === BATCH.address.toLowerCase()),
            });
            if (!created) throw new FriendlyError("Airdrop created, but its ID could not be read.");
            batchId = created.args.batchId;
          }
          p = {
            batchId,
            done: i + 1,
            total: chunks.length,
            txHashes: [...p.txHashes, hash],
            blockNumber: p.blockNumber ?? receipt.blockNumber,
          };
          update(p);
        }

        setResult({
          batchId: p.batchId!,
          txHashes: p.txHashes,
          blockNumber: p.blockNumber!,
          total: rows.reduce((s, r) => s + r.amount, 0n),
          count: rows.length,
        });
        setStep("success");
      } catch (e) {
        setError(toFriendlyMessage(e));
        setStep("error");
      } finally {
        void refreshChainReads(queryClient);
      }
    },
    [config, queryClient],
  );

  const isBusy = step !== "idle" && step !== "success" && step !== "error";
  const canResume = step === "error" && !!progress.batchId && progress.done < progress.total;

  return { create, reset, step, needsApproval, error, result, progress, isBusy, canResume };
}
