import { defineChain, type Address, type Chain, type Hash } from "viem";

/**
 * Single source of truth for the Arc networks, tokens and ArcClaim deployments.
 * The active network is chosen at runtime by the network switcher (see NetworkProvider);
 * nothing network-dependent should be hard-coded outside this file.
 */
export type NetworkKey = "testnet" | "mainnet";

export type ContractDeployment = {
  address: Address;
  /** Block the contract was deployed in; event scans start here. */
  deployBlock: bigint;
};

export type ArcNetwork = {
  key: NetworkKey;
  /** Short label for the switcher ("Testnet" / "Mainnet"). */
  name: string;
  /** Full name for UI copy ("Arc Testnet" / "Arc Mainnet"). */
  displayName: string;
  chainId: number;
  rpcUrl: string;
  usdcAddress: Address;
  usdcDecimals: number;
  explorerName: string;
  explorerUrl: string;
  isMainnet: boolean;
  /** ArcClaim deployments on this network. A missing entry means "not deployed here". */
  contracts: {
    /** Phase 1 ArcClaim (numeric claim ids, `/claim/[id]`). Testnet only. */
    claimV1?: ContractDeployment;
    /** ArcClaimV2 single payments (`/pay/[id]`). New payments go here. */
    claimV2?: ContractDeployment;
    /** ArcClaimBatch airdrops (`/airdrop/[id]`). */
    batch?: ContractDeployment;
  };
  /** The main ArcClaim contract (shown in the footer): V2, else Phase 1. */
  claimContractAddress?: Address;
  chain: Chain;
};

/** USDC ERC-20 interface on Arc — the token, NOT an ArcClaim contract. */
const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";
export const USDC_DECIMALS = 6;
export const USDC_SYMBOL = "USDC";

type NetworkProfile = Omit<ArcNetwork, "chain" | "claimContractAddress" | "usdcDecimals">;

const PROFILES: Record<NetworkKey, NetworkProfile> = {
  testnet: {
    key: "testnet",
    name: "Testnet",
    displayName: "Arc Testnet",
    chainId: 5042002,
    rpcUrl: "https://rpc.testnet.arc.network",
    usdcAddress: ARC_USDC,
    explorerName: "ArcScan",
    explorerUrl: "https://testnet.arcscan.app",
    isMainnet: false,
    // From contracts/broadcast/*/5042002/run-latest.json.
    contracts: {
      claimV1: { address: "0xDA2AfE4Ced93C02427F9924A628568D8405f5Dc4", deployBlock: 63_741_415n },
      claimV2: { address: "0xf9C01246746B4dd538D9fdEB08Df993473FE2948", deployBlock: 63_753_333n },
      batch: { address: "0x6bA799909E960c3828F7ad1A7d9b4988Af56CFA1", deployBlock: 63_753_333n },
    },
  },
  mainnet: {
    key: "mainnet",
    name: "Mainnet",
    displayName: "Arc Mainnet",
    chainId: 5042,
    rpcUrl: "https://rpc.mainnet.arc.io",
    usdcAddress: ARC_USDC,
    explorerName: "Arc Explorer",
    explorerUrl: "https://explorer.arc.io",
    isMainnet: true,
    // From contracts/broadcast/DeployPhase2.s.sol/5042/run-latest.json. Phase 1 was never deployed here.
    contracts: {
      claimV2: { address: "0xDA2AfE4Ced93C02427F9924A628568D8405f5Dc4", deployBlock: 22_513_232n },
      batch: { address: "0x8BDF2D2bDEd0d97eaeAA1Fc510cE6d005c920538", deployBlock: 22_513_232n },
    },
  },
};

function buildNetwork(p: NetworkProfile): ArcNetwork {
  return {
    ...p,
    usdcDecimals: USDC_DECIMALS,
    claimContractAddress: p.contracts.claimV2?.address ?? p.contracts.claimV1?.address,
    chain: defineChain({
      id: p.chainId,
      name: p.displayName,
      // Arc's native gas token is USDC (18 decimals at the native level).
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [p.rpcUrl] } },
      blockExplorers: { default: { name: p.explorerName, url: p.explorerUrl } },
      contracts: {
        multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 0 },
      },
      testnet: !p.isMainnet,
    }),
  };
}

export const NETWORKS: Record<NetworkKey, ArcNetwork> = {
  testnet: buildNetwork(PROFILES.testnet),
  mainnet: buildNetwork(PROFILES.mainnet),
};

export const NETWORK_KEYS: NetworkKey[] = ["testnet", "mainnet"];
export const DEFAULT_NETWORK: NetworkKey = "testnet";
/** localStorage key holding the selected network. */
export const NETWORK_STORAGE_KEY = "arcclaim:network";
/** Query parameter that shared links use to open on the right network. */
export const NETWORK_QUERY_PARAM = "network";

export const isNetworkKey = (v: unknown): v is NetworkKey => v === "testnet" || v === "mainnet";

/** Arc RPC rejects eth_getLogs ranges larger than this. */
export const LOG_BLOCK_RANGE = 10_000n;

export const explorerTxUrl = (network: ArcNetwork, hash: Hash) => `${network.explorerUrl}/tx/${hash}`;
export const explorerAddressUrl = (network: ArcNetwork, address: Address) =>
  `${network.explorerUrl}/address/${address}`;

/** Public WalletConnect project id (optional; enables mobile/QR wallets). */
export const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

/** Base URL used for shareable claim links. Falls back to the current origin. */
export function appBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/** Absolute shareable URL for an in-app path, tagged with its network so it opens there. */
export const shareUrl = (network: ArcNetwork, path: string) =>
  `${appBaseUrl()}${path}?${NETWORK_QUERY_PARAM}=${network.key}`;
