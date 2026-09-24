import type { Metadata } from "next";
import { PaymentView } from "@/components/PaymentView";
import { parsePaymentId } from "@/lib/payments";

export const metadata: Metadata = { title: "Claim payment — ArcClaim" };

/** ArcClaimV2 payments (opaque bytes32 payment id). */
export default async function PayPage({ params }: PageProps<"/pay/[id]">) {
  const { id } = await params;
  return <PaymentView paymentRef={parsePaymentId(id)} rawId={id} />;
}
