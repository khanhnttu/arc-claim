import type { Metadata } from "next";
import { PaymentView } from "@/components/PaymentView";
import { parseClaimId } from "@/lib/payments";

export async function generateMetadata({ params }: PageProps<"/claim/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Claim payment #${id} — ArcClaim` };
}

/** Phase 1 payments (ArcClaim v1, numeric claim id). */
export default async function ClaimPage({ params }: PageProps<"/claim/[id]">) {
  const { id } = await params;
  return <PaymentView paymentRef={parseClaimId(id)} rawId={id} />;
}
