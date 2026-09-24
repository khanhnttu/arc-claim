import type { Metadata } from "next";
import { AirdropCreate } from "@/components/AirdropCreate";
import { AirdropList } from "@/components/AirdropList";
import { buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Airdrops — ArcClaim" };

export default function AirdropPage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Distribute USDC</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Send USDC to multiple recipients in one batch. Each recipient claims their own allocation.
          </p>
        </div>
        <a href="#create-airdrop" className={buttonClass()}>
          Create Airdrop
        </a>
      </div>
      <AirdropList />
      <section id="create-airdrop" className="scroll-mt-24">
        <AirdropCreate />
      </section>
    </div>
  );
}
