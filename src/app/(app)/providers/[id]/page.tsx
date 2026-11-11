import { notFound } from "next/navigation";
import { providerDetail } from "@/lib/server/provider-detail";
import { ProviderDetailView } from "./ProviderDetailView";

export const dynamic = "force-dynamic";

export default async function ProviderPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { id } = await params;
  const data = providerDetail(id);
  if (!data) notFound();
  const sp = await searchParams;
  return <ProviderDetailView data={data} connected={sp.connected} error={sp.error} />;
}
