import { getQueue } from "@/lib/db";
export const runtime = "nodejs";
const esc = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
export async function GET() {
  const header = ["Payment ID","Vendor","Invoice","Initiated By","Amount","Status","Verdict","Risk Score","Signals","PayPal Ref"];
  const rows = getQueue().map((p) => [p.id,p.vendor.name,p.invoiceNumber,p.initiatedBy ?? "AP Team",p.amount.toFixed(2),p.status,p.effectiveVerdict ?? "UNASSESSED",p.assessment?.riskScore ?? "",p.assessment?.signals.join(" | ") ?? "",p.paypalRef ?? ""]);
  const csv = [header, ...rows].map((row) => row.map(esc).join(",")).join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=sentinel-audit.csv" } });
}
