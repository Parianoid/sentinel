import { NextResponse } from "next/server";
import { z } from "zod";
import { findByProviderRef, setStatus, updatePayoutByPaymentId, updatePayoutByProviderRef } from "@/lib/db";
import { verifyWebhook } from "@/lib/paypal";

const eventSchema = z.object({
  event_type: z.string(),
  resource: z.object({
    id: z.string().optional(),
    payout_item_id: z.string().optional(),
    transaction_status: z.string().optional(),
    payout_item: z.object({ sender_item_id: z.string().optional() }).optional(),
    supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().optional() }).optional() }).optional(),
  }).passthrough(),
}).passthrough();

export const runtime = "nodejs";

export async function POST(request: Request) {
  const raw = await request.json();
  const event = eventSchema.safeParse(raw);
  if (!event.success) return NextResponse.json({ error: "Invalid webhook event." }, { status: 400 });
  if (!(await verifyWebhook(request.headers, raw))) return NextResponse.json({ error: "Webhook verification failed." }, { status: 401 });

  const payoutRef = event.data.resource.payout_item_id || event.data.resource.id;
  if (payoutRef && event.data.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    const suffix = event.data.event_type.replace("PAYMENT.PAYOUTS-ITEM.", "");
    const state = suffix === "SUCCEEDED" ? "SUCCESS" : suffix;
    const updated = updatePayoutByProviderRef(payoutRef, state, raw);
    if (!updated && event.data.resource.payout_item?.sender_item_id) updatePayoutByPaymentId(event.data.resource.payout_item.sender_item_id, payoutRef, state, raw);
  }

  const legacyRef = event.data.resource.id || event.data.resource.supplementary_data?.related_ids?.order_id;
  const legacyPayment = legacyRef ? findByProviderRef(legacyRef) : undefined;
  if (legacyPayment && event.data.event_type === "PAYMENT.CAPTURE.COMPLETED") setStatus(legacyPayment.payment_request_id, "SETTLED");
  return NextResponse.json({ received: true });
}
