import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Bell, ShieldCheck } from "lucide-react";
import TourLauncher from "@/app/components/tour-launcher";
import AiModeToggle from "@/app/components/ai-mode-toggle";
import "./globals.css";
export const metadata: Metadata = { title: "Sentinel | Agentic Payment Trust", description: "AI trust layer for outgoing B2B payments" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><header className="topbar"><Link href="/queue" className="brand"><span className="brandMark"><ShieldCheck size={19}/></span><span>Sentinel</span></Link><span className="divider"/><span className="productLabel">Trust layer for agentic payments</span><div className="topActions"><AiModeToggle/><TourLauncher/><span className="liveDot"><i/> Sandbox connected</span><Bell size={18}/><span className="avatar">RM</span></div></header><div className="shell"><aside className="sidebar"><nav><Link href="/queue"><Activity size={18}/> Payment queue</Link><Link id="nav-results" href="/results"><ShieldCheck size={18}/> Results & audit</Link></nav><div className="sidebarFoot"><p>PAYPAL AI HACKATHON</p><strong>Sentinel v1.0</strong><span>Sandbox environment</span><a href="/api/openapi" target="_blank">API docs ↗</a></div></aside><main className="main">{children}</main></div></body></html>;
}
