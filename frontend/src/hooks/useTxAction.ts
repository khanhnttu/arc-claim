"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { Address, Hash } from "viem";
import { useConfig, type Config } from "wagmi";
import { toFriendlyMessage } from "@/lib/errors";
import { refreshChainReads, requireArcAccount, waitForSuccess } from "@/lib/tx";

export type TxPhase = "idle" | "checking" | "wallet" | "pending" | "success" | "error";

export const TX_PHASE_MESSAGE: Record<TxPhase, string> = {
  idle: "",
  checking: "Checking on-chain state…",
  wallet: "Waiting for wallet confirmation…",
  pending: "Transaction submitted. Waiting for confirmation…",
  success: "",
  error: "",
};

/** What a prepared action hands back: a function that submits the tx, and the success copy. */
export type PreparedTx = { send: () => Promise<Hash>; successText: string };

export type Prepare = (ctx: { config: Config; account: Address }) => Promise<PreparedTx>;

/**
 * Shared lifecycle for single-transaction actions (claim, cancel, refund):
 * network check → prepare (fresh reads, UX checks, simulate) → wallet → confirmation → refresh reads.
 */
export function useTxAction() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<TxPhase>("idle");
  const [error, setError] = useState<string>();
  const [successText, setSuccessText] = useState<string>();
  const [txHash, setTxHash] = useState<Hash>();

  const reset = useCallback(() => {
    setPhase("idle");
    setError(undefined);
    setSuccessText(undefined);
    setTxHash(undefined);
  }, []);

  const execute = useCallback(
    async (prepare: Prepare) => {
      setError(undefined);
      setSuccessText(undefined);
      setTxHash(undefined);
      try {
        setPhase("checking");
        const account = await requireArcAccount(config);
        const { send, successText } = await prepare({ config, account });
        setPhase("wallet");
        const hash = await send();
        setTxHash(hash);
        setPhase("pending");
        await waitForSuccess(config, hash);
        setSuccessText(successText);
        setPhase("success");
      } catch (e) {
        setError(toFriendlyMessage(e));
        setPhase("error");
      } finally {
        void refreshChainReads(queryClient);
      }
    },
    [config, queryClient],
  );

  const isBusy = phase === "checking" || phase === "wallet" || phase === "pending";
  return { execute, reset, phase, message: TX_PHASE_MESSAGE[phase], error, successText, txHash, isBusy };
}

export type TxAction = ReturnType<typeof useTxAction>;
