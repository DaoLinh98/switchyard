"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICON = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, "aria-hidden": true } as const;

/** Nav items in the order of the design. `href: null` = screen not built yet (MVP). */
const NAV: { label: string; href: string | null; match?: string; icon: React.ReactNode }[] = [
  { label: "Endpoint & Key", href: null, icon: <svg {...ICON}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></svg> },
  { label: "Providers", href: "/providers", match: "/providers", icon: <svg {...ICON}><path d="M4 7h16M4 12h16M4 17h10" /></svg> },
  { label: "CLI Tools", href: "/cli-tools", match: "/cli-tools", icon: <svg {...ICON}><path d="M5 8l4 4-4 4M12 16h7" /></svg> },
  { label: "Live traffic", href: "/traffic", match: "/traffic", icon: <svg {...ICON}><path d="M3 12h4l3-7 4 14 3-7h4" /></svg> },
  { label: "Quota tracker", href: null, icon: <svg {...ICON}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg> },
  {
    label: "Settings", href: null,
    icon: <svg {...ICON}><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></svg>,
  },
];

export function Sidebar({ endpoint }: { endpoint: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="sidebar">
      <div className="brand">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="26" height="26" rx="8" stroke="#2A303A" />
          <path d="M7 9h5c3 0 4 2 5 5s2 5 5 5" stroke="#E8D3A8" strokeWidth="2" strokeLinecap="round" />
          <path d="M7 19h15" stroke="#5B6573" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="brand-name">Switchyard</span>
      </div>
      <div className="proxy-box">
        <div className="proxy-state"><span className="proxy-dot" />Proxy running</div>
        <div className="proxy-url">{endpoint}</div>
      </div>
      <div className="nav">
        {NAV.map((item) => {
          const active = item.match ? pathname.startsWith(item.match) : false;
          return item.href ? (
            <Link key={item.label} href={item.href} className="nav-link" aria-current={active ? "page" : undefined}>
              {item.icon}{item.label}
            </Link>
          ) : (
            <a key={item.label} href="#" className="nav-link">{item.icon}{item.label}</a>
          );
        })}
      </div>
    </nav>
  );
}
