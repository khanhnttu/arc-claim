"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NetworkBanner, NetworkSwitcher } from "./NetworkSwitcher";
import { WalletButton } from "./WalletButton";
import { cn } from "./ui";

const NAV = [
  { href: "/", label: "Send Payment", short: "Send" },
  { href: "/airdrop", label: "Airdrop", short: "Airdrop" },
  { href: "/activity", label: "Activity", short: "Activity" },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
      {/* Phones: logo + network + wallet on the first row, nav on a second row. md+: one row. */}
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3 pb-2 md:h-16 md:flex-nowrap md:gap-6 md:py-0">
        <Link href="/" className="flex shrink-0 items-center" aria-label="ArcClaim home">
          <Logo />
        </Link>
        <nav className="order-last -mx-2 flex w-[calc(100%+1rem)] items-center text-sm md:order-none md:mx-0 md:w-auto md:gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-2 py-1.5 whitespace-nowrap transition-colors lg:px-3",
                  (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)) ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
                )}
              >
                {/* Full label on phones (own row) and from lg up; a shorter one keeps md on one line. */}
                <span className="md:hidden lg:inline">{item.label}</span>
                <span className="hidden md:inline lg:hidden">{item.short}</span>
              </Link>
            ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <NetworkSwitcher />
          <WalletButton />
        </div>
      </div>
      <NetworkBanner />
    </header>
  );
}

/**
 * Brand mark on phones, full lock-up from `sm` up. Light/dark variants follow the same
 * `prefers-color-scheme` switch as the rest of the theme (Tailwind's `dark:` variant).
 */
function Logo() {
  return (
    <>
      <Image src="/brand/arcclaim-mark.png" alt="ArcClaim" width={32} height={32} priority className="h-8 w-8 sm:hidden" />
      <Image
        src="/brand/arcclaim-logo-light.png"
        alt="ArcClaim"
        width={133}
        height={32}
        priority
        className="hidden h-8 w-auto sm:block dark:sm:hidden"
      />
      <Image
        src="/brand/arcclaim-logo-dark.png"
        alt=""
        aria-hidden
        width={133}
        height={32}
        priority
        className="hidden h-8 w-auto dark:sm:block"
      />
    </>
  );
}
