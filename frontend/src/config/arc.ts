import { defineChain, type Address, type Hash } from "viem";

/**
 * Single source of truth for the Arc network + token configuration.
 * NEXT_PUBLIC_ARC_NETWORK selects the network ("mainnet" or "testnet", default "testnet");
 * chain id, name, default RPC and explorer all follow from it.
 */
export const ARC_NETWORK: "mainnet" | "testnet" =
  process.env.NEXT_PUBLIC_ARC_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const IS_MAINNET = ARC_NETWORK === "mainnet";

const PROFILE = IS_MAINNET
  ? {
      id: 5042,
      name: "Arc Mainnet",
      rpc: "https://rpc.mainnet.arc.io",
      explorerName: "Arc Explorer",
      explorer: "https://explorer.arc.io",
    }
  : {
      id: 5042002,
      name: "Arc Testnet",
      rpc: "https://rpc.testnet.arc.io",
      explorerName: "ArcScan",
      explorer: "https://testnet.arcscan.app",
    };

/** Human-readable network name for UI copy ("Arc Mainnet" / "Arc Testnet"). */
export const NETWORK_NAME = PROFILE.name;

export const ARC_RPC_URL = process.env.NEXT_PUBLIC_ARC_RPC_URL || PROFILE.rpc;

export const ARC_EXPLORER_URL = PROFILE.explorer;

export const arcChain = defineChain({
  id: PROFILE.id,
  name: PROFILE.name,
  // Arc's native gas token is USDC (18 decimals at the native level).
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
  },
  blockExplorers: {
    default: { name: PROFILE.explorerName, url: ARC_EXPLORER_URL },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      blockCreated: 0,
    },
  },
  testnet: !IS_MAINNET,
});

/** USDC ERC-20 interface on Arc (6 decimals). Overridable only for local test chains. */
export const USDC_ADDRESS: Address =
  (process.env.NEXT_PUBLIC_USDC_ADDRESS as Address | undefined) || "0x3600000000000000000000000000000000000000";
export const USDC_DECIMALS = 6;
export const USDC_SYMBOL = "USDC";

/** Arc RPC rejects eth_getLogs ranges larger than this. */
export const LOG_BLOCK_RANGE = 10_000n;

export const explorerTxUrl = (hash: Hash) => `${ARC_EXPLORER_URL}/tx/${hash}`;
export const explorerAddressUrl = (address: Address) =>
  `${ARC_EXPLORER_URL}/address/${address}`;

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

export const claimUrl = (claimId: bigint | string) =>
  `${appBaseUrl()}/claim/${claimId.toString()}`;
