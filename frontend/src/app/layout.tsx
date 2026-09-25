import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { NetworkScope } from "@/components/NetworkProvider";
import { NetworkFooter } from "@/components/NetworkSwitcher";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:py-14">
            <NetworkScope>{children}</NetworkScope>
          </main>
          <footer className="border-t border-border">
            <NetworkFooter />
          </footer>
        </Providers>
      </body>
    </html>
  );
}
