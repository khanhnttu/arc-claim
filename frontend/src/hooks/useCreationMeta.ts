"use client";

import { useQuery } from "@tanstack/react-query";
import { getAbiItem, type AbiEvent, type Address, type Hash, type PublicClient } from "viem";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import type { ArcNetwork } from "@/config/arc";
import { useNetwork } from "@/components/NetworkProvider";
import { firstBlockWhere, latestBlock, logsInBlock, readAtBlock } from "@/lib/historical";
import { loadCache, saveCache } from "@/lib/logScan";
import { activityTargets, recordId } from "./useSenderActivity";

export type CreationMeta = { txHash: Hash; blockNumber: bigint };
export type CreationKind = "v1" | "v2" | "batch";

const CREATION_EVENT = {
  v1: { name: "ClaimCreated", idArg: "claimId" },
  v2: { name: "PaymentCreated", idArg: "paymentId" },
  batch: { name: "BatchCreated", idArg: "batchId" },
} as const;

/** Persistent cache key; network + contract + record id, so Testnet/Mainnet or redeploys never mix. */
export const activityMetaKey = (network: ArcNetwork, contract: Address, id: bigint | string) =>
  `arcclaim:activity-meta:${network.key}:${contract.toLowerCase()}:${id.toString()}`;

async function resolveCreation(
  client: PublicClient,
  network: ArcNetwork,
  kind: CreationKind,
  nonce: bigint,
): Promise<CreationMeta> {
  const target = activityTargets(network).find((t) => t.kind === kind);
  const deployment = network.contracts[kind === "v1" ? "claimV1" : kind === "v2" ? "claimV2" : "batch"];
  if (!target || !deployment) throw new Error("Contract not deployed on this network");
  const chainId = network.chainId;

  // Created by block B  ⇔  the contract's counter at B has reached this record's nonce.
  const head = await latestBlock(client, chainId);
  const block = await firstBlockWhere(deployment.deployBlock, head, async (b) => {
    const count = await readAtBlock<bigint>(client, chainId, { address: target.address, abi: target.abi, functionName: target.counter }, b);
    return kind === "v1" ? count > nonce : count >= nonce;
  });
  if (block === undefined) throw new Error("Creation block not found");

  // One log query, for that single block.
  const ev = CREATION_EVENT[kind];
  const event = getAbiItem({ abi: target.abi, name: ev.name }) as AbiEvent;
  const logs = await logsInBlock(() =>
    client.getLogs({
      address: target.address,
      event,
      args: { [ev.idArg]: recordId(target, chainId, nonce) },
      fromBlock: block,
      toBlock: block,
    }),
  );
  const log = logs[0];
  if (!log?.transactionHash) throw new Error("Creation log not found");
  return { txHash: log.transactionHash, blockNumber: block };
}

/**
 * Creation tx + block of one Activity record, resolved on demand (only rows that are rendered call this)
 * and cached in localStorage. Cached records make no RPC calls. One retry, then the row shows a manual Retry.
 */
export function useCreationMeta(kind: CreationKind, nonce: bigint) {
  const config = useConfig();
  const network = useNetwork();
  const target = activityTargets(network).find((t) => t.kind === kind);
  const id = target ? recordId(target, network.chainId, nonce) : undefined;
  const key = target && id !== undefined ? activityMetaKey(network, target.address, id) : undefined;

  return useQuery({
    queryKey: ["arcclaim-activity-meta", key],
    enabled: !!key,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    retryDelay: 2_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialData: () => (key ? loadCache<CreationMeta>(key) : undefined),
    queryFn: async () => {
      const client = getPublicClient(config, { chainId: network.chainId }) as PublicClient | undefined;
      if (!client) throw new Error("No RPC client");
      const meta = await resolveCreation(client, network, kind, nonce);
      saveCache(key!, meta);
      return meta;
    },
  });
}
