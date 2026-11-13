"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, type ColDef, type GridApi } from "ag-grid-community";
import { driver } from "driver.js";
import { Bot, Play, RotateCw, Search, Send, ShieldAlert, Syringe, X } from "lucide-react";
import type { QueueItem, RiskAssessment, Verdict } from "@/lib/types";
import type { AiMode } from "@/app/components/ai-mode-toggle";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import "driver.js/dist/driver.css";

ModuleRegistry.registerModules([AllCommunityModule]);
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function previewAssessment(payment: QueueItem): RiskAssessment {
  const poisoned = payment.id === "p-poison" || payment.id.startsWith("p-attack");
  return {
    paymentRequestId: payment.id,
    riskScore: poisoned ? 96 : 12,
    verdict: poisoned ? "HOLD" : "RELEASE",
    confidence: poisoned ? .98 : .94,
    primaryReason: poisoned ? "Payee changed, amount is roughly 3× normal, and the request uses urgent account-change language." : "Payment matches the vendor's established identity and amount pattern.",
    signals: poisoned ? ["PAYEE_CHANGED", "AMOUNT_ANOMALY", "URGENT_ACCOUNT_CHANGE_LANGUAGE"] : ["KNOWN_PAYEE_MATCH", "AMOUNT_WITHIN_HISTORY"],
    recommendedAction: poisoned ? "Freeze payment and verify through the known-good vendor contact." : "Release under standard controls.",
    rationale: poisoned ? "The combined destination change, extreme amount, and pressure language are characteristic of business email compromise." : "No meaningful fraud indicator is present.",
    deterministicFlags: poisoned ? ["PAYEE_CHANGED", "AMOUNT_ANOMALY"] : [],
    createdAt: new Date().toISOString(),
  };
}

export default function QueueClient() {
  const [rows, setRows] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [aiMode, setAiMode] = useState<AiMode>("deterministic");
  const [liveAiAvailable, setLiveAiAvailable] = useState(false);
  const [draft, setDraft] = useState<{ to: string; subject: string; body: string } | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [tourPreview, setTourPreview] = useState(false);
  const apiRef = useRef<GridApi | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/queue", { cache: "no-store" });
    const data = await response.json();
    setRows(data.payments);
    setLiveAiAvailable(Boolean(data.liveAiAvailable));
    setSelected((current) => current ? data.payments.find((payment: QueueItem) => payment.id === current.id) ?? null : null);
  }, []);

  const displayRows = useMemo(() => rows.map((payment) => {
    if (!tourPreview || payment.assessment) return payment;
    const assessment = previewAssessment(payment);
    return { ...payment, assessment, effectiveVerdict: assessment.verdict };
  }), [rows, tourPreview]);

  const startTour = useCallback(() => {
    setWelcome(false);
    setTourPreview(true);
    localStorage.setItem("sentinel_onboarded", "true");
    window.setTimeout(() => {
      const tour = driver({
        showProgress: true,
        allowClose: true,
        overlayColor: "#001B5E",
        stagePadding: 8,
        onDestroyed: () => setTourPreview(false),
        steps: [
          { element: "#stat-tiles", popover: { title: "Your queue at a glance", description: "See total exposure, screened volume, money at risk, and what is ready to release." } },
          { element: "#payment-grid", popover: { title: "Every outgoing payment", description: "A real AG Grid queue is visually grouped by vendor, with pinned totals and risk evidence." } },
          { element: "#run-sentinel", popover: { title: "Run Sentinel", description: "The AI scores each payment for fraud. This tour uses a safe local preview—no PayPal call is made." } },
          { element: ".poison-row", popover: { title: "Caught: business email compromise", description: "Payee changed + amount roughly 3× normal + urgency language. Sentinel freezes the Acme payment." } },
          { element: "#release-approved", popover: { title: "You keep final authority", description: "Only human-approved RELEASE decisions can move through PayPal Sandbox." } },
          { element: "#inject-attack", popover: { title: "Try it live", description: "Add a fresh fraud attempt and watch Sentinel catch it on re-assessment." } },
          { element: "#nav-results", popover: { title: "Results and audit", description: "See money saved, PayPal references, and the downloadable decision trail." } },
        ],
      });
      tour.drive();
    }, 120);
  }, []);

  useEffect(() => {
    const storedMode = localStorage.getItem("sentinel_ai_mode");
    if (storedMode === "live") setAiMode("live");
    void load();
    const replay = () => startTour();
    const modeChanged = (event: Event) => setAiMode((event as CustomEvent<AiMode>).detail);
    window.addEventListener("sentinel:replay-tour", replay);
    window.addEventListener("sentinel:ai-mode", modeChanged);
    const requested = new URLSearchParams(window.location.search).get("tour") === "1";
    if (requested) startTour();
    else if (!localStorage.getItem("sentinel_onboarded")) setWelcome(true);
    return () => { window.removeEventListener("sentinel:replay-tour", replay); window.removeEventListener("sentinel:ai-mode", modeChanged); };
  }, [load, startTour]);

  useEffect(() => {
    if (!rows.some((row) => row.status === "PROCESSING" && !row.paypalRef?.startsWith("SANDBOX-PENDING"))) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [rows, load]);

  const assessed = displayRows.filter((row) => row.assessment);
  const atRisk = displayRows.filter((row) => row.effectiveVerdict === "HOLD" || row.effectiveVerdict === "ESCALATE");
  const heldCount = displayRows.filter((row) => row.effectiveVerdict === "HOLD").length;
  const releasable = rows.filter((row) => row.effectiveVerdict === "RELEASE" && ["PENDING", "FAILED"].includes(row.status));

  const override = async (id: string, verdict: "RELEASE" | "HOLD") => {
    await fetch("/api/override", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: id, verdict }) });
    await load();
    setMessage(`Human decision saved: ${verdict}`);
  };
  const run = async () => {
    setTourPreview(false);
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/assess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: aiMode }) });
    setLoading(false);
    if (!response.ok) { const data = await response.json().catch(() => ({})); setMessage(data.error || "Assessment failed — check configuration."); return; }
    await load();
    setMessage(aiMode === "live" ? "Live AI returned payment-specific rationales." : "Deterministic demo screened all pending payments.");
  };
  const inject = async () => {
    setLoading(true);
    await fetch("/api/inject", { method: "POST" });
    const response = await fetch("/api/assess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: aiMode }) });
    setLoading(false);
    await load();
    setMessage(response.ok ? "Live attack injected — Sentinel caught the new threat." : "Attack added, but assessment needs attention.");
  };
  const draftVerification = async (paymentId: string) => {
    const response = await fetch("/api/draft-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId }) });
    const data = await response.json();
    if (!response.ok) { setMessage(data.error || "Could not create the verification draft."); return; }
    setDraft(data);
  };
  const release = async () => {
    setLoading(true);
    const response = await fetch("/api/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentIds: releasable.map((payment) => payment.id) }) });
    const data = await response.json();
    setLoading(false);
    await load();
    setMessage(data.pendingReason ? `Sandbox settlement pending: ${data.pendingReason}` : `${data.results?.filter((result: { state: string }) => result.state !== "SKIPPED").length ?? 0} approved payments sent in one PayPal Payouts batch.`);
  };

  const vendorStats = useMemo(() => new Map(displayRows.map((row) => {
    const members = displayRows.filter((item) => item.vendorId === row.vendorId);
    return [row.vendorId, { count: members.length, total: members.reduce((sum, item) => sum + item.amount, 0) }];
  })), [displayRows]);

  const columns = useMemo<ColDef<QueueItem>[]>(() => [
    { headerName: "Vendor", field: "vendor.name", minWidth: 190, flex: 1.1, cellRenderer: (params: { data?: QueueItem; node: { rowIndex: number | null } }) => {
      const payment = params.data;
      if (!payment) return "";
      const index = params.node.rowIndex ?? 0;
      const first = index === 0 || displayRows[index - 1]?.vendorId !== payment.vendorId;
      const stats = vendorStats.get(payment.vendorId);
      return first ? <div className="vendorGroup"><strong>{payment.vendor.name}</strong><span>{stats?.count} items · {money(stats?.total ?? 0)}</span></div> : <span className="vendorRepeat">↳ {payment.vendor.name}</span>;
    } },
    { headerName: "Invoice #", field: "invoiceNumber", width: 112, cellClass: "invoiceCell", onCellClicked: (params) => params.data && setSelected(params.data) },
    { headerName: "Amount", field: "amount", width: 105, valueFormatter: (params) => money(Number(params.value || 0)) },
    { headerName: "Initiated by", field: "initiatedBy", width: 145, cellRenderer: (params: { value?: string }) => params.value === "Procurement Agent" ? <span className="agentBadge"><Bot size={11}/>Procurement Agent</span> : <span className="mutedCell">AP Team</span> },
    { headerName: "Payee email", field: "payeeEmail", minWidth: 190, flex: 1.1 },
    { headerName: "Risk", width: 78, valueGetter: (params) => params.data?.assessment?.riskScore, cellRenderer: (params: { value?: number }) => params.value == null ? "—" : <span className={`riskPill ${params.value >= 70 ? "riskRed" : params.value >= 40 ? "riskAmber" : "riskGreen"}`}>{params.value}</span> },
    { headerName: "Verdict", width: 132, valueGetter: (params) => params.data?.effectiveVerdict, cellRenderer: (params: { value?: Verdict; data?: QueueItem }) => params.value ? <span className={`verdictPill verdict${params.value[0] + params.value.slice(1).toLowerCase()}`}>{params.value} <small>{Math.round((params.data?.assessment?.confidence ?? 0) * 100)}%</small></span> : <span className="modeBadge">UNASSESSED</span> },
    { headerName: "Signals", minWidth: 150, flex: .9, cellRenderer: (params: { data?: QueueItem }) => <div className="signalChips">{(params.data?.assessment?.signals || []).slice(0, 2).map((signal) => <span className="chip" key={signal}>{signal.replaceAll("_", " ")}</span>)}</div> },
    { headerName: "Actions", width: 190, sortable: false, cellRenderer: (params: { data?: QueueItem }) => params.data?.id && params.data.status === "PENDING" ? <div className="cellActions"><button className="miniBtn release" onClick={() => override(params.data!.id, "RELEASE")}>Release</button><button className="miniBtn hold" onClick={() => override(params.data!.id, "HOLD")}>Hold</button></div> : <span className="modeBadge">{params.data?.status === "PROCESSING" && params.data.paypalRef?.startsWith("SANDBOX-PENDING") ? "Sandbox settlement (pending)" : params.data?.status}</span> },
  ], [displayRows, vendorStats]);

  const pinned = useMemo(() => [{
    id: "__total", invoiceNumber: `${displayRows.length} payments`, amount: displayRows.reduce((sum, row) => sum + row.amount, 0),
    payeeEmail: `At risk: ${money(atRisk.reduce((sum, row) => sum + row.amount, 0))}`,
    vendor: { name: `QUEUE TOTAL · ${heldCount} HELD` }, status: "PENDING", effectiveVerdict: heldCount ? "HOLD" : null,
  } as unknown as QueueItem], [displayRows, atRisk, heldCount]);
  const activeSelected = selected ? displayRows.find((row) => row.id === selected.id) ?? selected : null;
  const maxHistory = activeSelected ? Math.max(activeSelected.amount, ...activeSelected.vendor.historicalPayments) : 1;

  return <>
    <div className="pageHead"><div><p className="eyebrow">Agent-vs-agent payment control</p><h1>Payment approval queue</h1><p>Sentinel reviews payments from people and autonomous procurement agents before settlement.</p></div><div className="actionRow"><button id="inject-attack" className="button buttonSecondary" disabled={loading} onClick={inject}><Syringe size={15}/>Inject attack</button><button className="button buttonSecondary" onClick={() => load()}><RotateCw size={15}/>Refresh</button><button id="run-sentinel" className="button buttonPrimary" disabled={loading} onClick={run}><Play size={15}/>{loading ? "Running…" : "Run Sentinel"}</button><button id="release-approved" className="button buttonSky" disabled={loading || !releasable.length} onClick={release}><Send size={15}/>Release approved ({releasable.length})</button></div></div>
    <section id="stat-tiles" className="metricGrid"><div className="metric"><span className="metricLabel">Queue value</span><div className="metricValue">{money(displayRows.reduce((sum, row) => sum + row.amount, 0))}</div><div className="metricMeta">{displayRows.length} payment requests</div></div><div className="metric"><span className="metricLabel">Screened</span><div className="metricValue">{assessed.length} / {displayRows.length}</div><div className="metricMeta">{tourPreview ? "Safe tour preview" : aiMode === "live" ? liveAiAvailable ? "Live Groq assessment" : "Live AI needs a Groq key" : "Deterministic demo mode"}</div></div><div className="metric alert"><span className="metricLabel">At risk</span><div className="metricValue">{money(atRisk.reduce((sum, row) => sum + row.amount, 0))}</div><div className="metricMeta">{atRisk.length} payments require attention</div></div><div className="metric"><span className="metricLabel">Ready to release</span><div className="metricValue">{displayRows.filter((row) => row.effectiveVerdict === "RELEASE").length}</div><div className="metricMeta">Human authority is final</div></div></section>
    <section className="panel"><div className="panelToolbar"><ShieldAlert size={17} color="#002991"/><h2>Outgoing payments</h2><span className="modeBadge">Visually grouped by vendor</span><div style={{ position: "relative", marginLeft: "auto" }}><Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "#98a2b3" }}/><input className="search" style={{ paddingLeft: 31 }} placeholder="Search vendor, invoice, payee…" onChange={(event) => apiRef.current?.setGridOption("quickFilterText", event.target.value)}/></div></div>
      <div id="payment-grid" className="ag-theme-quartz" style={{ height: 560, width: "100%" }}><AgGridReact<QueueItem> rowData={displayRows} columnDefs={columns} pinnedBottomRowData={pinned} getRowId={(params) => params.data.id} onGridReady={(params) => apiRef.current = params.api} rowSelection={{ mode: "singleRow", enableClickSelection: true }} onRowClicked={(params) => { if (params.data && params.data.id !== "__total") { setSelected(params.data); setDraft(null); } }} getRowClass={(params) => ["HOLD", "ESCALATE"].includes(params.data?.effectiveVerdict ?? "") ? "poison-row" : undefined} getRowStyle={(params) => params.data?.effectiveVerdict === "HOLD" ? { backgroundColor: "#fff8f7" } : params.data?.effectiveVerdict === "ESCALATE" ? { backgroundColor: "#fffcf5" } : undefined}/></div>
      {activeSelected?.assessment ? <div className="evidence"><div><p className="eyebrow">Evidence drawer · {activeSelected.invoiceNumber}</p><h3>{activeSelected.assessment.primaryReason}</h3><p>{activeSelected.assessment.rationale}</p><div className="evidenceList">{[...activeSelected.assessment.deterministicFlags, ...activeSelected.assessment.signals].filter((value, index, all) => all.indexOf(value) === index).map((signal) => <span className="chip" key={signal}>{signal.replaceAll("_", " ")}</span>)}</div>{["HOLD", "ESCALATE"].includes(activeSelected.effectiveVerdict ?? "") && <><button className="button buttonSecondary verifyButton" onClick={() => draftVerification(activeSelected.id)}>Draft verification email</button>{draft && <div className="emailDraft"><strong>To: {draft.to}</strong><span>Subject: {draft.subject}</span><pre>{draft.body}</pre><button className="miniBtn" onClick={() => { void navigator.clipboard.writeText(`To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`); setMessage("Verification draft copied."); }}>Copy draft</button></div>}</>}</div><div><h3>Payee and amount evidence</h3><div className="compare"><div><label>Vendor known-good</label><strong>{activeSelected.vendor.knownGoodEmail}<br/>Bank •••• {activeSelected.vendor.knownGoodBankLast4}</strong></div><div className={(activeSelected.payeeEmail.toLowerCase() !== activeSelected.vendor.knownGoodEmail.toLowerCase() || activeSelected.payeeBankLast4 !== activeSelected.vendor.knownGoodBankLast4) ? "compareMismatch" : "compareMatch"}><label>This payment</label><strong>{activeSelected.payeeEmail}<br/>Bank •••• {activeSelected.payeeBankLast4}</strong></div></div><div className="historyLabel"><span>Vendor payment history</span><strong>Current: {money(activeSelected.amount)}</strong></div><div className="historyBars">{activeSelected.vendor.historicalPayments.length ? activeSelected.vendor.historicalPayments.map((amount, index) => <span key={index} className="bar" title={money(amount)} style={{ height: `${Math.max(8, amount / maxHistory * 100)}%` }}/>) : <span className="noHistory">No prior payments</span>}<span className="bar current" title={`Current ${money(activeSelected.amount)}`} style={{ height: `${activeSelected.amount / maxHistory * 100}%` }}/></div></div></div> : <div className="emptyAssessment">{activeSelected ? "Run Sentinel to generate this payment's evidence." : "Select an invoice row to open its evidence drawer."}</div>}
      <div className="gridCredit">Data grid powered by <strong>AG Grid</strong> · Community-safe vendor grouping and inline evidence drawer</div>
    </section>
    {welcome && <div className="modalBackdrop"><div className="welcomeModal"><button aria-label="Close" className="modalClose" onClick={() => { localStorage.setItem("sentinel_onboarded", "true"); setWelcome(false); }}><X size={18}/></button><div className="welcomeIcon"><ShieldAlert size={24}/></div><p className="eyebrow">Welcome to Sentinel</p><h2>Sentinel — the trust layer for agentic payments</h2><div className="welcomeLines"><p><strong>$3.05B lost to business email compromise in 2025.</strong> It was the #2 cybercrime by dollars—and AI is making fake emails flawless.</p><p><strong>Sentinel screens every outgoing vendor payment.</strong> The agent releases clean payments through PayPal and freezes fraudulent ones.</p><p><strong>You stay in control.</strong> Every decision is explainable, reviewable, and auditable.</p></div><div className="modalActions"><button className="button buttonPrimary" onClick={startTour}>Take the 60-second tour</button><button className="button buttonSecondary" onClick={() => { localStorage.setItem("sentinel_onboarded", "true"); setWelcome(false); }}>Skip</button></div></div></div>}
    {message && <div className="toast" onClick={() => setMessage("")}>{message}</div>}
  </>;
}
