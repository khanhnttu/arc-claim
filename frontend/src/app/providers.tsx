"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { DEFAULT_NETWORK, NETWORKS } from "@/config/arc";
import { wagmiConfig } from "@/config/wagmi";
import { NetworkProvider } from "@/components/NetworkProvider";

const theme = { borderRadius: "medium", fontStack: "system" } as const;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={NETWORKS[DEFAULT_NETWORK].chain}
          appInfo={{ appName: "ArcClaim" }}
          theme={{
            lightMode: lightTheme({ ...theme, accentColor: "#0b0b0f" }),
            darkMode: darkTheme({ ...theme, accentColor: "#fafafa", accentColorForeground: "#09090b" }),
          }}
        >
          <NetworkProvider>{children}</NetworkProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
