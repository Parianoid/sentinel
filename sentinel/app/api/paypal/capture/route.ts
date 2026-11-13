import { NextResponse } from "next/server";
import { z } from "zod";
import { captureOrderAndAudit, orderIdSchema } from "@/lib/paypal-capture";

export const runtime = "nodejs";

const captureQuerySchema = z.object({ token: orderIdSchema });

export async function GET(request: Request) {
  try {
    const query = captureQuerySchema.parse({
      token: new URL(request.url).searchParams.get("token"),
    });
    const audit = await captureOrderAndAudit(query.token);

    return NextResponse.json({
      orderId: audit.orderId,
      captureId: audit.captureId,
      status: audit.status,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid PayPal capture request.", details: error.flatten() },
        { status: 400 },
      );
    }

    console.error("PayPal capture failed", error);
    return NextResponse.json(
      { error: "Unable to capture the PayPal Sandbox order." },
      { status: 502 },
    );
  }
}
