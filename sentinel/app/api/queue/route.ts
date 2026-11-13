import { NextResponse } from "next/server";
import { getQueue } from "@/lib/db";
import { reconcileOpenPayoutBatches } from "@/lib/payouts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  await reconcileOpenPayoutBatches();
  return NextResponse.json({ payments: getQueue(), liveAiAvailable: Boolean(process.env.GROQ_API_KEY) });
}
