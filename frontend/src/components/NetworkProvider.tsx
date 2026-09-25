"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  DEFAULT_NETWORK,
  NETWORKS,
  NETWORK_QUERY_PARAM,
  NETWORK_STORAGE_KEY,
  isNetworkKey,
  type ArcNetwork,
  type NetworkKey,
} from "@/config/arc";

type NetworkContextValue = { network: ArcNetwork; setNetwork: (key: NetworkKey) => void };

const NetworkContext = createContext<NetworkContextValue | null>(null);

// The selection lives in localStorage; this tiny store lets every tab/component observe it.
const listeners = new Set<() => void>();

function readStored(): NetworkKey {
  try {
    const v = localStorage.getItem(NETWORK_STORAGE_KEY);
    return isNetworkKey(v) ? v : DEFAULT_NETWORK;
  } catch {
    return DEFAULT_NETWORK;
  }
}

function writeStored(key: NetworkKey) {
  try {
    localStorage.setItem(NETWORK_STORAGE_KEY, key);
  } catch {
    // Storage unavailable — the selection still applies for this page view via `memory`.
  }
  memory = key;
  listeners.forEach((l) => l());
}

let memory: NetworkKey | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === NETWORK_STORAGE_KEY) {
      memory = undefined;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = () => memory ?? readStored();
// The server (and the first client render) always see the default, so hydration matches.
const getServerSnapshot = () => DEFAULT_NETWORK;

/** Selected Arc network (Testnet by default), persisted under `arcclaim:network`. */
export function NetworkProvider({ children }: { children: ReactNode }) {
  const key = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Shared links carry `?network=` so a Mainnet claim link opens on Mainnet.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get(NETWORK_QUERY_PARAM);
    if (isNetworkKey(fromUrl) && fromUrl !== getSnapshot()) writeStored(fromUrl);
  }, []);

  const setNetwork = useCallback((next: NetworkKey) => writeStored(next), []);
  const value = useMemo(() => ({ network: NETWORKS[key], setNetwork }), [key, setNetwork]);
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetworkContext() {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used inside <NetworkProvider>");
  return ctx;
}

/** The currently selected Arc network config. */
export const useNetwork = () => useNetworkContext().network;

/**
 * Remounts its children whenever the network changes, so no per-page state
 * (forms, in-progress flows, resumable airdrops) carries over between Testnet and Mainnet.
 */
export function NetworkScope({ children }: { children: ReactNode }) {
  const network = useNetwork();
  return <div key={network.key} className="contents">{children}</div>;
}
