import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { IS_MAINNET, NETWORK_NAME, explorerAddressUrl } from "@/config/arc";
import { V1, V2, isV1Enabled, isV2Enabled } from "@/lib/payments";
import { shortAddress } from "@/lib/format";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Icons come from the App Router file conventions: src/app/favicon.ico, icon.png and apple-icon.png.
export const metadata: Metadata = {
  title: "ArcClaim — Programmable USDC Payments on Arc",
  applicationName: "ArcClaim",
  appleWebApp: { title: "ArcClaim" },
  description:
    "Send to one. Distribute to many. Let recipients claim. Recover what's unclaimed.",
};

/** The payments contract new payments go to (V2 once configured, otherwise Phase 1). */
const footerContract = isV2Enabled ? V2.address : isV1Enabled ? V1.address : undefined;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:py-14">{children}</main>
          <footer className="border-t border-border">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted">
              <span>{IS_MAINNET ? `ArcClaim · ${NETWORK_NAME}` : `ArcClaim · ${NETWORK_NAME} · Testnet funds only`}</span>
              {footerContract && (
                <a
                  href={explorerAddressUrl(footerContract)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono hover:text-fg"
                >
                  Contract {shortAddress(footerContract)} ↗
                </a>
              )}
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
