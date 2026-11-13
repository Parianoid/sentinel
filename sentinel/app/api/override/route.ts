import { NextResponse } from "next/server";
import { z } from "zod";
import { setOverride } from "@/lib/db";
const schema = z.object({ paymentId: z.string().min(1), verdict: z.enum(["RELEASE", "HOLD"]) });
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid override." }, { status: 400 });
  setOverride(parsed.data.paymentId, parsed.data.verdict);
  return NextResponse.json({ ok: true });
}
