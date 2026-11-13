import { NextResponse } from "next/server";
import { pendingQueue, saveAssessment } from "@/lib/db";
import { assessPayment } from "@/lib/risk";
import { z } from "zod";
export const runtime = "nodejs";
const requestSchema = z.object({ mode: z.enum(["deterministic", "live"]).default("deterministic") });
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid assessment mode." }, { status: 400 });
    if (parsed.data.mode === "live" && !process.env.GROQ_API_KEY) return NextResponse.json({ error: "Live AI is not configured. Add GROQ_API_KEY and restart Sentinel." }, { status: 503 });
    const queue = pendingQueue();
    const assessments = [];
    for (let index = 0; index < queue.length; index += 1) {
      const payment = queue[index];
      const priorInvoices = queue.filter((p) => p.vendorId === payment.vendorId && p.id !== payment.id && p.submittedAt < payment.submittedAt).map((p) => p.invoiceNumber);
      const assessment = await assessPayment(payment, payment.vendor, priorInvoices, parsed.data.mode);
      saveAssessment(assessment);
      assessments.push(assessment);
      if (parsed.data.mode === "live" && index < queue.length - 1) await wait(400);
    }
    return NextResponse.json({ assessments, mode: parsed.data.mode === "live" ? "groq-live" : "deterministic-demo" });
  } catch (error) {
    console.error("Sentinel assessment failed", error);
    return NextResponse.json({ error: "Assessment failed. Check the Groq configuration and model access, then try again." }, { status: 502 });
  }
}
