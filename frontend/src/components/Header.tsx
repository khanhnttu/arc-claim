"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./WalletButton";
import { cn } from "./ui";

const NAV = [
  { href: "/", label: "Send Payment", short: "Send" },
  { href: "/airdrop", label: "Airdrop", short: "Airdrop" },
  { href: "/dashboard", label: "Dashboard", short: "Dashboard" },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-6">
          <Link href="/" className="flex shrink-0 items-center" aria-label="ArcClaim home">
            <Logo />
          </Link>
          <nav className="flex items-center text-sm sm:gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-2 py-1.5 transition-colors sm:px-3",
                  (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)) ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
                )}
              >
                {/* Full label from sm up; a shorter one keeps the header on one line on phones. */}
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sm:hidden">{item.short}</span>
              </Link>
            ))}
          </nav>
        </div>
        <WalletButton />
      </div>
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
