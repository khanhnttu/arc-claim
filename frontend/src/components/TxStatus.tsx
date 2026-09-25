"use client";

import type { Hash } from "viem";
import { explorerTxUrl } from "@/config/arc";
import { useNetwork } from "./NetworkProvider";
import { Notice, Spinner } from "./ui";

/** Inline lifecycle line for a transaction: pending spinner, success or error. */
export function TxStatus({
  busy,
  message,
  error,
  success,
  txHash,
}: {
  busy: boolean;
  message?: string;
  error?: string;
  success?: string;
  txHash?: Hash;
}) {
  if (busy && message) {
    return (
      <Notice tone="info" className="flex items-center gap-2">
        <Spinner className="text-accent" />
        <span>{message}</span>
        {txHash && <ExplorerLink hash={txHash} />}
      </Notice>
    );
  }
  if (error) return <Notice tone="error">{error}</Notice>;
  if (success) {
    return (
      <Notice tone="success" className="flex flex-wrap items-center gap-x-2">
        <span>{success}</span>
        {txHash && <ExplorerLink hash={txHash} />}
      </Notice>
    );
  }
  return null;
}

function ExplorerLink({ hash }: { hash: Hash }) {
  const network = useNetwork();
  return (
    <a href={explorerTxUrl(network, hash)} target="_blank" rel="noreferrer" className="ml-auto underline underline-offset-2">
      View tx ↗
    </a>
  );
}
