import { NextResponse } from "next/server";
import { injectAttack } from "@/lib/db";
export const runtime = "nodejs";
export async function POST(){return NextResponse.json({paymentId:injectAttack()},{status:201})}
