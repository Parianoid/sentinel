import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  BrainCircuit,
  Check,
  CheckCircle2,
  Landmark,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { z } from "zod";
import { captureOrderAndAudit, orderIdSchema, type AuditEntry } from "@/lib/paypal-capture";

export const dynamic = "force-dynamic";

type ReceiptPageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

function formatMoney(value: string, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Number(value));
}

export default async function ReceiptPage({ searchParams }: ReceiptPageProps) {
  let audit: AuditEntry | null = null;
  let errorMessage: string | null = null;

  try {
    const params = await searchParams;
    const token = orderIdSchema.parse(
      Array.isArray(params.token) ? params.token[0] : params.token,
    );
    audit = await captureOrderAndAudit(token);
  } catch (error) {
    console.error("Receipt processing failed", error);
    errorMessage = error instanceof z.ZodError
      ? "The PayPal return URL did not contain a valid order token."
      : "We could not confirm the PayPal Sandbox capture. No success receipt was issued.";
  }

  if (!audit) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <section className="rounded-2xl border border-red-200 bg-white p-8 text-center shadow-card">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-50 text-red-700">
            <ShieldCheck size={27} />
          </span>
          <h1 className="mt-5 text-3xl font-black tracking-tight">Payment not confirmed</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-black/55">{errorMessage}</p>
          <Link href="/invoice" className="mt-7 inline-flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-black text-white">
            <ArrowLeft size={16} /> Return to invoice
          </Link>
        </section>
      </main>
    );
  }

  const timeline = [
    {
      title: "AI proposed 0.3% discount",
      detail: audit.aiRationale,
      icon: BrainCircuit,
    },
    {
      title: "Human approved",
      detail: `${audit.humanApprovedBy} authorized the recommended payment.`,
      icon: UserCheck,
    },
    {
      title: "Rules enforced",
      detail: audit.enforcedRule,
      icon: ShieldCheck,
    },
    {
      title: "PayPal captured payment",
      detail: `Capture ID ${audit.captureId}`,
      icon: Landmark,
    },
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/" className="mb-7 inline-flex items-center gap-2 text-sm font-black text-black/55 hover:text-black">
        <ArrowLeft size={16} /> Back to dashboard
      </Link>

      <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-card">
        <div className="bg-emerald-50 px-6 py-8 text-center sm:px-10">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/20">
            <CheckCircle2 size={34} strokeWidth={2.5} />
          </span>
          <div className="mt-5 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-[.16em] text-emerald-700">
            <BadgeCheck size={15} /> PayPal Sandbox confirmed
          </div>
          <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">Payment Successful</h1>
          <p className="mt-3 text-base font-bold text-black/55">
            Paid {formatMoney(audit.amount, audit.currency)} via PayPal Sandbox
          </p>
        </div>

        <dl className="grid gap-px bg-black/10 sm:grid-cols-3">
          <div className="bg-white p-5"><dt className="text-xs font-bold text-black/40">Invoice</dt><dd className="mt-1 font-black">INV-2026-041</dd></div>
          <div className="bg-white p-5"><dt className="text-xs font-bold text-black/40">PayPal Order ID</dt><dd className="mt-1 break-all text-sm font-black">{audit.orderId}</dd></div>
          <div className="bg-white p-5"><dt className="text-xs font-bold text-black/40">PayPal Capture ID</dt><dd className="mt-1 break-all text-sm font-black text-paypal-navy">{audit.captureId}</dd></div>
        </dl>
      </section>

      <section className="mt-7 rounded-2xl border border-black/10 bg-white p-6 shadow-card sm:p-8">
        <div className="mb-7">
          <p className="text-xs font-black uppercase tracking-[.15em] text-paypal-navy">Traceability record</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">Audit timeline</h2>
          <p className="mt-1 text-sm text-black/45">Immutable decision context for this payment.</p>
        </div>

        <ol className="relative ml-5 border-l-2 border-paypal-sky/60">
          {timeline.map(({ title, detail, icon: Icon }, index) => (
            <li key={title} className="relative pb-8 pl-9 last:pb-0">
              <span className="absolute -left-[19px] top-0 grid h-9 w-9 place-items-center rounded-full border-4 border-white bg-paypal-navy text-white">
                <Icon size={15} />
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-black/35">Step {index + 1}</span>
                <Check size={13} className="text-emerald-600" strokeWidth={3} />
              </div>
              <h3 className="mt-1 font-black">{title}</h3>
              <p className="mt-1 text-sm leading-6 text-black/55">{detail}</p>
            </li>
          ))}
        </ol>

        <p className="mt-7 border-t border-black/10 pt-5 text-xs font-semibold text-black/40">
          Recorded {new Date(audit.timestamp).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
        </p>
      </section>
    </main>
  );
}
