"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, ShieldAlert } from "lucide-react";
import type { QueueItem } from "@/lib/types";
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
type Summary = { releasedAmount: number; releasedCount: number; blockedAmount: number; blockedCount: number; queue: QueueItem[] };
export default function ResultsClient() {
  const [data, setData] = useState<Summary | null>(null);
  const load = useCallback(() => fetch("/api/results", { cache: "no-store" }).then((response) => response.json()).then(setData), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!data?.queue.some((payment) => payment.status === "PROCESSING" && !payment.paypalRef?.startsWith("SANDBOX-PENDING"))) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [data, load]);
  if (!data) return <p>Loading audit ledger…</p>;
  return <>
    <div className="pageHead"><div><p className="eyebrow">Decision ledger</p><h1>Results & audit</h1><p>Every agent judgment, human decision, and PayPal reference in one place.</p></div><div className="actionRow"><button className="button buttonSecondary" onClick={load}><RefreshCw size={15}/>Refresh</button><a className="button buttonPrimary" href="/api/audit"><Download size={15}/>Export audit CSV</a></div></div>
    <section className="heroResult"><div><h2>Sentinel protected this payment run</h2><p>Fraud blocked: {data.blockedCount} {data.blockedCount === 1 ? "payment" : "payments"}, {money(data.blockedAmount)} saved.</p></div><div className="saved"><span>Money kept outside the fraud path</span>{money(data.blockedAmount)}</div></section>
    <div className="impactBanner"><ShieldAlert size={20}/><div><strong>$3.05B was lost to business email compromise in 2025.</strong><span>The #2 cybercrime by dollars—and AI is making fraudulent messages harder to distinguish.</span></div></div>
    <section className="metricGrid"><div className="metric"><span className="metricLabel">Released</span><div className="metricValue">{money(data.releasedAmount)}</div><div className="metricMeta">{data.releasedCount} completed payouts · settled</div></div><div className="metric alert"><span className="metricLabel">Fraud blocked</span><div className="metricValue">{data.blockedCount}</div><div className="metricMeta">{money(data.blockedAmount)} saved</div></div><div className="metric"><span className="metricLabel">Audited</span><div className="metricValue">{data.queue.length}</div><div className="metricMeta">100% decision coverage</div></div><div className="metric"><span className="metricLabel">Control status</span><div className="metricValue" style={{ color: "#067647" }}>Active</div><div className="metricMeta">Deterministic gates enforced</div></div></section>
    <section className="panel"><div className="panelToolbar"><h2>Full decision ledger</h2><span className="modeBadge">Downloadable audit trail</span></div><div style={{ overflowX: "auto" }}><table className="auditTable"><thead><tr><th>Vendor / invoice</th><th>Initiated by</th><th>Amount</th><th>Risk</th><th>Decision</th><th>Status</th><th>Primary reason</th><th>PayPal reference</th></tr></thead><tbody>{data.queue.map((payment) => <tr key={payment.id}><td><strong>{payment.vendor.name}</strong><br/><span style={{ color: "#667085" }}>{payment.invoiceNumber}</span></td><td>{payment.initiatedBy === "Procurement Agent" ? <span className="agentBadge">Procurement Agent</span> : "AP Team"}</td><td>{money(payment.amount)}</td><td>{payment.assessment ? <span className={`riskPill ${payment.assessment.riskScore >= 70 ? "riskRed" : payment.assessment.riskScore >= 40 ? "riskAmber" : "riskGreen"}`}>{payment.assessment.riskScore}</span> : "—"}</td><td>{payment.effectiveVerdict ? <span className={`verdictPill verdict${payment.effectiveVerdict[0] + payment.effectiveVerdict.slice(1).toLowerCase()}`}>{payment.effectiveVerdict}</span> : "UNASSESSED"}</td><td>{payment.status === "PROCESSING" && payment.paypalRef?.startsWith("SANDBOX-PENDING") ? "Sandbox settlement (pending)" : payment.status}</td><td style={{ maxWidth: 360, color: "#475467" }}>{payment.assessment?.primaryReason ?? "Awaiting assessment"}</td><td className="paypalRef">{payment.paypalRef ?? "—"}</td></tr>)}</tbody></table></div></section>
  </>;
}
