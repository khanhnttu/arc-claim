"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { Address } from "viem";
import { useSwitchChain } from "wagmi";
import { useUsdcBalance } from "@/hooks/useUsdcBalance";
import { formatUsdc } from "@/lib/format";
import { useNetwork } from "./NetworkProvider";
import { Button } from "./ui";

export function WalletButton({ label = "Connect Wallet", block }: { label?: string; block?: boolean }) {
  const network = useNetwork();
  const { switchChain, isPending } = useSwitchChain();
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        const width = block ? "w-full" : undefined;

        if (!ready) {
          return <div aria-hidden className="h-10 w-36 rounded-xl bg-surface-2" />;
        }
        if (!connected) {
          return (
            <Button size={block ? "lg" : "sm"} className={width} onClick={openConnectModal}>
              {label}
            </Button>
          );
        }
        if (chain.unsupported) {
          return (
            <Button size={block ? "lg" : "sm"} variant="danger" className={width} onClick={openChainModal}>
              Wrong network — switch to Arc
            </Button>
          );
        }
        // On the other Arc network than the one selected in the app.
        if (chain.id !== network.chainId) {
          return (
            <Button
              size={block ? "lg" : "sm"}
              variant="danger"
              className={width}
              loading={isPending}
              onClick={() => switchChain({ chainId: network.chainId })}
            >
              Switch to {network.name}
            </Button>
          );
        }
        return (
          <button
            onClick={openAccountModal}
            className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-border bg-surface pr-1 pl-1 text-sm font-medium hover:bg-surface-2 sm:pl-3"
          >
            <BalanceLabel address={account.address as Address} />
            <span className="rounded-lg bg-surface-2 px-2 py-1 font-mono text-xs">{account.displayName}</span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

function BalanceLabel({ address }: { address: Address }) {
  const { data } = useUsdcBalance(address);
  return (
    <span className="hidden tabular-nums sm:inline">
      {data === undefined ? "…" : formatUsdc(data, 2)} <span className="text-muted">USDC</span>
    </span>
  );
}
