import type { Metadata } from "next";
import { AirdropView } from "@/components/AirdropView";
import { parseBatchId } from "@/lib/batches";

export const metadata: Metadata = { title: "Airdrop — ArcClaim" };

export default async function AirdropDetailPage({ params, searchParams }: PageProps<"/airdrop/[id]">) {
  const { id } = await params;
  const { created } = await searchParams;
  return <AirdropView batchId={parseBatchId(id)} rawId={id} justCreated={created === "1"} />;
}
