import Link from "next/link";
import { ArrowLeft, BadgeCheck, Bot, CalendarDays, Check, Clock3, FileText, LockKeyhole, Sparkles } from "lucide-react";
import { PayPalButton } from "./paypal-button";

export default function InvoicePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/" className="mb-7 inline-flex items-center gap-2 text-sm font-black text-black/55 hover:text-black"><ArrowLeft size={16} /> Back to invoices</Link>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[.16em] text-paypal-navy"><FileText size={14} /> Invoice review</div>
          <h1 className="text-4xl font-black tracking-[-.04em] sm:text-5xl">INV-2026-041</h1>
          <p className="mt-2 text-sm text-black/50">Aster Components · Due November 28, 2026</p>
        </div>
        <span className="w-fit rounded-full bg-paypal-sky/25 px-3 py-1.5 text-xs font-black tracking-wide text-paypal-navy ring-1 ring-paypal-sky/40">OFFER READY</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.08fr_.92fr]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-black/10 bg-white p-6 shadow-card">
            <div className="mb-6 flex items-center justify-between border-b border-black/10 pb-5">
              <div><p className="text-xs font-black uppercase tracking-[.14em] text-black/40">Supplier</p><p className="mt-1 text-xl font-black">Aster Components</p></div>
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-paypal-sand text-lg font-black">AC</span>
            </div>
            <dl className="grid gap-5 sm:grid-cols-3">
              <div><dt className="text-xs font-bold text-black/40">Invoice amount</dt><dd className="mt-1 text-2xl font-black">$100,000.00</dd></div>
              <div><dt className="text-xs font-bold text-black/40">Issue date</dt><dd className="mt-1 flex items-center gap-1.5 text-sm font-black"><CalendarDays size={15} /> Oct 29, 2026</dd></div>
              <div><dt className="text-xs font-bold text-black/40">Payment terms</dt><dd className="mt-1 flex items-center gap-1.5 text-sm font-black"><Clock3 size={15} /> Net 30</dd></div>
            </dl>
          </section>

          <section className="overflow-hidden rounded-2xl border border-paypal-sky/70 bg-paypal-navy text-white shadow-card">
            <div className="flex items-center justify-between border-b border-white/15 bg-white/5 px-6 py-4">
              <div className="flex items-center gap-2 text-sm font-black"><Sparkles size={17} className="text-paypal-sky" /> AI recommended offer</div>
              <span className="rounded-full bg-paypal-sky px-2.5 py-1 text-[10px] font-black tracking-wider text-black">HIGH CONFIDENCE</span>
            </div>
            <div className="p-6">
              <p className="text-3xl font-black tracking-tight sm:text-4xl">Pay day 10 <span className="text-paypal-sky">·</span> 0.3% discount</p>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/65">Optimized against supplier acceptance history, your cash position, and the invoice due-date curve.</p>
              <div className="mt-7 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/10 p-4"><p className="text-xs font-bold text-white/55">Savings unlocked</p><p className="mt-1 text-2xl font-black text-paypal-sky">$300.00</p></div>
                <div className="rounded-xl bg-white/10 p-4"><p className="text-xs font-bold text-white/55">Total to pay</p><p className="mt-1 text-2xl font-black">$99,700.00</p></div>
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-black/10 bg-paypal-sand p-6 shadow-card">
            <div className="mb-5 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white"><LockKeyhole size={19} /></span><div><h2 className="font-black">Deterministic rules enforced</h2><p className="text-xs text-black/45">Policy checks run after AI recommendation</p></div></div>
            <ul className="space-y-3">
              {["Discount cap verified (≤ 0.5%)", "Cash headroom sufficient", "Duplicate invoice check passed", "Human approval required before payment"].map((rule) => (
                <li key={rule} className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-bold ring-1 ring-black/5"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check size={13} strokeWidth={3} /></span>{rule}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-black/10 bg-white p-6 shadow-card">
            <div className="mb-5 flex items-center gap-2 text-sm font-black"><BadgeCheck size={18} className="text-paypal-navy" /> Human approval</div>
            <div className="mb-6 flex items-center justify-between rounded-xl border border-black/10 p-4"><div><p className="text-sm font-black">Alex Morgan</p><p className="text-xs text-black/45">Treasury manager · You</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700 ring-1 ring-emerald-200">AUTHORIZED</span></div>
            <PayPalButton />
            <div className="mt-5 flex items-center justify-center gap-2 border-t border-black/10 pt-5 text-[11px] font-bold text-black/40"><Bot size={14} /> AI proposes · rules constrain · humans approve</div>
          </section>
        </aside>
      </div>
    </main>
  );
}
