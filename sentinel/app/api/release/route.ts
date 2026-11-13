import { NextResponse } from "next/server";
import { z } from "zod";
import { releasePayoutBatch } from "@/lib/payouts";

const releaseRequestSchema = z.object({ paymentIds: z.array(z.string().min(1)).min(1) });
export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = releaseRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Select at least one approved payment." }, { status: 400 });
  const outcome = await releasePayoutBatch([...new Set(parsed.data.paymentIds)]);
  return NextResponse.json(outcome, { status: outcome.pendingReason ? 202 : 200 });
}
