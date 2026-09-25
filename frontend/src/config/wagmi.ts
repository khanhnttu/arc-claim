import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { NETWORKS, WALLETCONNECT_PROJECT_ID } from "./arc";

const APP_NAME = "ArcClaim";

// WalletConnect-based wallets need a project id; without one we fall back to
// browser-extension wallets only so the app still works out of the box.
const wallets = WALLETCONNECT_PROJECT_ID
  ? [metaMaskWallet, rabbyWallet, coinbaseWallet, rainbowWallet, walletConnectWallet]
  : [injectedWallet, rabbyWallet, coinbaseWallet];

const connectors = connectorsForWallets([{ groupName: "Wallets", wallets }], {
  appName: APP_NAME,
  // A placeholder is only passed when no WalletConnect wallet is listed.
  projectId: WALLETCONNECT_PROJECT_ID || "arcclaim-no-walletconnect",
});

const { testnet, mainnet } = NETWORKS;

// Both Arc networks are always configured; the app-level network switcher picks which one is used.
export const wagmiConfig = createConfig({
  chains: [testnet.chain, mainnet.chain],
  connectors,
  transports: {
    [testnet.chainId]: http(testnet.rpcUrl),
    [mainnet.chainId]: http(mainnet.rpcUrl),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
