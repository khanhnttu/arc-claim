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
import { ARC_RPC_URL, WALLETCONNECT_PROJECT_ID, arcChain } from "./arc";

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

export const wagmiConfig = createConfig({
  chains: [arcChain],
  connectors,
  transports: { [arcChain.id]: http(ARC_RPC_URL) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
