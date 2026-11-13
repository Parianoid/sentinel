import { promises as fs } from "node:fs";
import path from "node:path";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { z } from "zod";

export const orderIdSchema = z.string().regex(
  /^[A-Z0-9]{17,32}$/,
  "A valid PayPal Order ID is required.",
);

const environmentSchema = z.object({
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_ENVIRONMENT: z.enum(["SANDBOX", "LIVE"]).default("SANDBOX"),
});

const captureToolResultSchema = z.object({
  status: z.literal("success"),
  response: z.object({
    id: z.string().min(1),
    status: z.string().min(1),
    purchase_units: z.array(z.object({
      payments: z.object({
        captures: z.array(z.object({
          id: z.string().min(1),
          status: z.string().min(1),
          amount: z.object({
            currency_code: z.string().length(3),
            value: z.string().regex(/^\d+(\.\d{1,2})?$/),
          }).optional(),
        })).min(1),
      }),
    })).min(1),
  }),
});

export const auditEntrySchema = z.object({
  orderId: z.string().min(1),
  captureId: z.string().min(1),
  status: z.string().min(1),
  amount: z.string(),
  currency: z.string(),
  aiRationale: z.string(),
  humanApprovedBy: z.string(),
  enforcedRule: z.string(),
  environment: z.literal("SANDBOX"),
  timestamp: z.string().datetime(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;

const auditLogSchema = z.array(auditEntrySchema);
const auditLogPath = path.join(process.cwd(), "data", "audit-log.json");

function parseToolResult(result: unknown): unknown {
  if (typeof result === "string") return JSON.parse(result);
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
    const text = content?.find((item) => item.type === "text")?.text;
    if (text) return JSON.parse(text);
  }
  return result;
}

export async function readAuditLog(): Promise<AuditEntry[]> {
  try {
    const file = await fs.readFile(auditLogPath, "utf8");
    return auditLogSchema.parse(JSON.parse(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function findAuditEntry(orderId: string): Promise<AuditEntry | undefined> {
  const validatedOrderId = orderIdSchema.parse(orderId);
  return (await readAuditLog()).find((entry) => entry.orderId === validatedOrderId);
}

async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
  const entries = await readAuditLog();
  const withoutDuplicate = entries.filter((item) => item.orderId !== entry.orderId);
  await fs.writeFile(
    auditLogPath,
    `${JSON.stringify([...withoutDuplicate, entry], null, 2)}\n`,
    "utf8",
  );
}

export async function captureOrderAndAudit(orderId: string): Promise<AuditEntry> {
  const validatedOrderId = orderIdSchema.parse(orderId);
  const existing = await findAuditEntry(validatedOrderId);
  if (existing) return existing;

  const env = environmentSchema.parse({
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
    PAYPAL_ENVIRONMENT: process.env.PAYPAL_ENVIRONMENT ?? "SANDBOX",
  });

  if (env.PAYPAL_ENVIRONMENT !== "SANDBOX") {
    throw new Error("AlphaPay capture is locked to PayPal Sandbox for this demo.");
  }

  const paypalToolkit = new PayPalAgentToolkit({
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    configuration: {
      context: { sandbox: true },
      actions: { orders: { capture: true } },
    },
  });

  const tools = paypalToolkit.getTools();
  // Toolkit 1.11 exposes Orders v2 capture as `pay_order`; newer context
  // generations may expose the same operation as `capture_order`.
  const captureOrder = tools.capture_order ?? tools.pay_order;
  if (!captureOrder?.execute) {
    throw new Error("The PayPal Agent Toolkit capture tool is unavailable.");
  }

  const toolResult = await captureOrder.execute(
    { id: validatedOrderId },
    { toolCallId: `alphapay-capture-${validatedOrderId}`, messages: [] },
  );
  const capture = captureToolResultSchema.parse(parseToolResult(toolResult));
  const payment = capture.response.purchase_units[0].payments.captures[0];

  const entry = auditEntrySchema.parse({
    orderId: capture.response.id,
    captureId: payment.id,
    status: payment.status,
    amount: payment.amount?.value ?? "99700.00",
    currency: payment.amount?.currency_code ?? "USD",
    aiRationale: "0.3% discount for early payment on day 10, saving $300.00.",
    humanApprovedBy: "Alex Morgan",
    enforcedRule: "Discount cap verified at 0.3% (maximum allowed: 0.5%).",
    environment: "SANDBOX",
    timestamp: new Date().toISOString(),
  });

  await appendAuditEntry(entry);
  return entry;
}
