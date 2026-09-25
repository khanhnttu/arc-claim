"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { NETWORKS, NETWORK_KEYS, explorerAddressUrl, type ArcNetwork, type NetworkKey } from "@/config/arc";
import { shortAddress } from "@/lib/format";
import { useNetwork, useNetworkContext } from "./NetworkProvider";
import { Button, cn } from "./ui";

function NetworkDot({ network, className }: { network: ArcNetwork; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("h-2 w-2 shrink-0 rounded-full", network.isMainnet ? "bg-success" : "bg-warning", className)}
    />
  );
}

/** Compact navbar dropdown for choosing the Arc network (Testnet / Mainnet). */
export function NetworkSwitcher() {
  const { network, setNetwork } = useNetworkContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (key: NetworkKey) => {
    setNetwork(key);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Arc network: ${network.name}. Change network`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 rounded-xl border bg-surface px-3 text-sm font-medium hover:bg-surface-2",
          network.isMainnet ? "border-success/40" : "border-border",
        )}
      >
        <NetworkDot network={network} />
        <span>{network.name}</span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-muted" fill="currentColor" aria-hidden>
          <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" />
        </svg>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Arc network"
          className="absolute right-0 z-30 mt-2 w-52 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          <p className="px-3 pt-2 pb-1.5 text-xs font-medium text-muted">Arc network</p>
          {NETWORK_KEYS.map((key) => {
            const n = NETWORKS[key];
            const selected = key === network.key;
            return (
              <button
                key={key}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => choose(key)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2",
                  selected && "bg-surface-2 font-medium",
                )}
              >
                <span className="w-4 text-accent" aria-hidden>
                  {selected ? "✓" : ""}
                </span>
                <NetworkDot network={n} />
                <span className="flex-1">{n.name}</span>
                <span className="font-mono text-xs text-muted">{n.chainId}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Shown under the navbar when the connected wallet is on a different chain than the selected network,
 * and (subtly) when Mainnet is selected, since those transactions move real USDC.
 */
export function NetworkBanner() {
  const network = useNetwork();
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error, reset } = useSwitchChain();
  useEffect(() => reset(), [network.key, reset]);

  const wrongNetwork = isConnected && chainId !== undefined && chainId !== network.chainId;

  if (wrongNetwork) {
    return (
      <div role="alert" className="border-b border-danger/25 bg-danger-bg">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
          <div className="min-w-0 flex-1 text-danger">
            <p className="font-semibold">Wrong network</p>
            <p>
              You&apos;re connected to the wrong network. Switch your wallet to {network.displayName} (chain{" "}
              {network.chainId}).
            </p>
            {error && <p className="mt-1 text-xs">Couldn&apos;t switch automatically. Change the network in your wallet.</p>}
          </div>
          <Button size="sm" variant="danger" loading={isPending} onClick={() => switchChain({ chainId: network.chainId })}>
            Switch Network
          </Button>
        </div>
      </div>
    );
  }

  if (network.isMainnet) {
    return (
      <div className="border-b border-border bg-surface">
        <p className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-1.5 text-xs text-muted">
          <NetworkDot network={network} className="h-1.5 w-1.5" />
          <span className="font-medium text-fg">{network.name}</span>
          <span aria-hidden>·</span>
          <span>Transactions use real USDC.</span>
        </p>
      </div>
    );
  }

  return null;
}

/** "Not found" helper: links are per network, so offer the other one. */
export function OtherNetworkHint() {
  const { network, setNetwork } = useNetworkContext();
  const other = NETWORKS[network.key === "testnet" ? "mainnet" : "testnet"];
  return (
    <p className="mt-3 text-sm text-muted">
      Created on {other.displayName}?{" "}
      <button type="button" className="font-medium text-accent hover:underline" onClick={() => setNetwork(other.key)}>
        Switch to {other.name}
      </button>
    </p>
  );
}

/** Footer line: network name + the selected network's main ArcClaim contract. */
export function NetworkFooter() {
  const network = useNetwork();
  const contract = network.claimContractAddress;
  return (
    <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted">
      <span>ArcClaim · {network.displayName}</span>
      {contract ? (
        <a
          href={explorerAddressUrl(network, contract)}
          target="_blank"
          rel="noreferrer"
          title={contract}
          className="font-mono hover:text-fg"
        >
          Contract {shortAddress(contract)} ↗
        </a>
      ) : (
        <span>Contract not deployed</span>
      )}
    </div>
  );
}

/** Inline network name for server-rendered pages. */
export function NetworkName() {
  return <>{useNetwork().displayName}</>;
}
