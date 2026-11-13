import { NextResponse } from "next/server";
import { resultsSummary } from "@/lib/db";
import { reconcileOpenPayoutBatches } from "@/lib/payouts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { await reconcileOpenPayoutBatches(); return NextResponse.json(resultsSummary()); }
