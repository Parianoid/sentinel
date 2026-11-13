"use client";

import { useState } from "react";
import { ArrowUpRight, LoaderCircle, ShieldCheck } from "lucide-react";

export function PayPalButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createOrder() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // PayPal adds `?token=<orderId>` when it returns the approved buyer.
          returnUrl: `${window.location.origin}/receipt`,
          cancelUrl: `${window.location.origin}/invoice?paypal=cancelled`,
        }),
      });
      const payload = (await response.json()) as { orderId?: string; approveUrl?: string; error?: string };
      if (!response.ok || !payload.approveUrl) throw new Error(payload.error || "PayPal did not return an approval link.");
      window.location.assign(payload.approveUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to start PayPal checkout.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button onClick={createOrder} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-full bg-paypal-navy px-6 py-4 text-base font-black text-white shadow-lg shadow-paypal-navy/20 transition hover:-translate-y-0.5 hover:bg-[#001f70] disabled:cursor-wait disabled:opacity-70">
        {loading ? <LoaderCircle className="animate-spin" size={19} /> : <ShieldCheck size={19} />}
        {loading ? "Creating secure order…" : "Pay $99,700 with PayPal"}
        {!loading && <ArrowUpRight size={17} />}
      </button>
      <p className="mt-3 text-center text-xs font-semibold text-black/45">You’ll continue to the real PayPal Sandbox to review and approve.</p>
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700 ring-1 ring-red-200">{error}</p>}
    </div>
  );
}
