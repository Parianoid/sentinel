import { NextResponse } from "next/server";
import { z } from "zod";
import { getQueue } from "@/lib/db";

const requestSchema = z.object({ paymentId: z.string().min(1) });
export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a payment to verify." }, { status: 400 });
  const payment = getQueue().find((item) => item.id === parsed.data.paymentId);
  if (!payment || !["HOLD", "ESCALATE"].includes(payment.effectiveVerdict ?? "")) return NextResponse.json({ error: "Verification drafts are available for held or escalated payments." }, { status: 409 });
  const differences = [
    payment.payeeEmail.toLowerCase() !== payment.vendor.knownGoodEmail.toLowerCase() ? `payee email ${payment.payeeEmail}` : null,
    payment.payeeBankLast4 !== payment.vendor.knownGoodBankLast4 ? `bank account ending ${payment.payeeBankLast4}` : null,
  ].filter(Boolean).join(" and ");
  const detail = differences || `the amount of $${payment.amount.toLocaleString("en-US")} on invoice ${payment.invoiceNumber}`;
  return NextResponse.json({
    to: payment.vendor.knownGoodEmail,
    subject: `Please verify invoice ${payment.invoiceNumber}`,
    body: `Hello ${payment.vendor.name} team,\n\nBefore we release invoice ${payment.invoiceNumber}, please confirm ${detail}. For security, reply from this known contact or call your usual AP contact; please do not send new banking details by email.\n\nThank you,\nAccounts Payable`,
  });
}
