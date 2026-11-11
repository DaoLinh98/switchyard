import { PROVIDERS } from "@/lib/catalog";
import { connectedProviders, connectionCounts } from "@/lib/server/providers";
import { ProvidersView } from "./ProvidersView";

export const dynamic = "force-dynamic";

export default function ProvidersPage() {
  const counts = connectionCounts();
  return (
    <ProvidersView
      connected={connectedProviders()}
      catalog={PROVIDERS.map((p) => ({ info: p, connections: counts[p.id] ?? 0 }))}
    />
  );
}
