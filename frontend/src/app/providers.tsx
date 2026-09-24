"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { arcChain } from "@/config/arc";
import { wagmiConfig } from "@/config/wagmi";

const theme = { borderRadius: "medium", fontStack: "system" } as const;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={arcChain}
          appInfo={{ appName: "ArcClaim" }}
          theme={{
            lightMode: lightTheme({ ...theme, accentColor: "#0b0b0f" }),
            darkMode: darkTheme({ ...theme, accentColor: "#fafafa", accentColorForeground: "#09090b" }),
          }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
