import { NextResponse } from "next/server";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { z } from "zod";

export const runtime = "nodejs";

const orderSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  links: z.array(z.object({
    href: z.string().url(),
    rel: z.string(),
    method: z.string().optional(),
  })),
});

const createOrderRequestSchema = z.object({
  returnUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

function parseToolResult(result: unknown): unknown {
  if (typeof result === "string") return JSON.parse(result);
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
    const text = content?.find((item) => item.type === "text")?.text;
    if (text) return JSON.parse(text);
  }
  return result;
}

export async function POST(request: Request) {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "PayPal Sandbox credentials are not configured." }, { status: 503 });
  }

  try {
    const requestBody = createOrderRequestSchema.parse(await request.json());
    const paypalToolkit = new PayPalAgentToolkit({
      clientId,
      clientSecret,
      configuration: {
        context: { sandbox: (process.env.PAYPAL_ENVIRONMENT ?? "SANDBOX") === "SANDBOX" },
        actions: { orders: { create: true, get: true } },
      },
    });

    const createOrder = paypalToolkit.getTools().create_order;
    if (!createOrder?.execute) throw new Error("PayPal create_order tool is unavailable.");

    // Contract shape and response validation follow the PayPal Orders v2 schema
    // supplied by the APIMatic PayPal Context Plugin (`npx context-plugins install paypal`).
    const result = await createOrder.execute({
      currencyCode: "USD",
      items: [{
        name: "Invoice INV-2026-041",
        description: "Aster Components — early payment offer",
        quantity: 1,
        itemCost: 100000,
        itemTotal: 100000,
        taxPercent: 0,
      }],
      discount: 300,
      shippingCost: 0,
      // PayPal appends `token=<orderId>` to this URL after buyer approval.
      returnUrl: requestBody.returnUrl,
      cancelUrl: requestBody.cancelUrl,
    }, { toolCallId: "alphapay-create-order", messages: [] });

    const order = orderSchema.parse(parseToolResult(result));
    const approveUrl = order.links.find((link) => link.rel === "approve" || link.rel === "payer-action")?.href;
    if (!approveUrl) throw new Error("PayPal did not return an approval URL.");

    return NextResponse.json({ orderId: order.id, approveUrl });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid PayPal order request.", details: error.flatten() },
        { status: 400 },
      );
    }
    console.error("PayPal order creation failed", error);
    return NextResponse.json({ error: "Unable to create the PayPal Sandbox order." }, { status: 502 });
  }
}
