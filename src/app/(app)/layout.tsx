import { Sidebar } from "@/components/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <Sidebar endpoint="http://127.0.0.1:8787/v1" />
      <main className="main">{children}</main>
    </div>
  );
}
