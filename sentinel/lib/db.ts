import Database from "better-sqlite3";
import path from "node:path";
import { payments, vendors } from "@/lib/seed";
import type { QueueItem, RiskAssessment, Vendor } from "@/lib/types";

const db = new Database(path.join(process.cwd(), process.env.SENTINEL_DB_FILE || "sentinel-v2.db"));
db.pragma("busy_timeout = 10000");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS vendors (id TEXT PRIMARY KEY, name TEXT NOT NULL, known_good_email TEXT NOT NULL, known_good_bank_last4 TEXT NOT NULL, historical_payments TEXT NOT NULL, first_seen_date TEXT NOT NULL, is_sole_source INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS payment_requests (id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL, invoice_number TEXT NOT NULL, amount REAL NOT NULL, payee_email TEXT NOT NULL, payee_bank_last4 TEXT NOT NULL, request_email_text TEXT NOT NULL, submitted_at TEXT NOT NULL, status TEXT NOT NULL, human_override TEXT);
  CREATE TABLE IF NOT EXISTS risk_assessments (payment_request_id TEXT PRIMARY KEY, risk_score INTEGER NOT NULL, verdict TEXT NOT NULL, confidence REAL NOT NULL, primary_reason TEXT NOT NULL, signals TEXT NOT NULL, recommended_action TEXT NOT NULL, rationale TEXT NOT NULL, deterministic_flags TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS release_results (payment_request_id TEXT PRIMARY KEY, paypal_ref TEXT NOT NULL, capture_ref TEXT, state TEXT NOT NULL, raw TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS release_claims (payment_request_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, paypal_order_id TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS payout_batches (fingerprint TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, payout_batch_id TEXT, state TEXT NOT NULL, baseline TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS payout_items (payment_request_id TEXT PRIMARY KEY, batch_fingerprint TEXT NOT NULL, payout_item_id TEXT, recipient_email TEXT NOT NULL, state TEXT NOT NULL, raw TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(batch_fingerprint) REFERENCES payout_batches(fingerprint));
`);

const seed = db.transaction(() => {
  const vendorInsert = db.prepare("INSERT OR IGNORE INTO vendors VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const vendor of vendors) vendorInsert.run(vendor.id, vendor.name, vendor.knownGoodEmail, vendor.knownGoodBankLast4, JSON.stringify(vendor.historicalPayments), vendor.firstSeenDate, vendor.isSoleSource ? 1 : 0);
  const paymentInsert = db.prepare("INSERT OR IGNORE INTO payment_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const payment of payments) paymentInsert.run(payment.id, payment.vendorId, payment.invoiceNumber, payment.amount, payment.payeeEmail, payment.payeeBankLast4, payment.requestEmailText, payment.submittedAt, payment.status, payment.humanOverride);
});
seed();

const parseVendor = (row: any): Vendor => ({ id: row.id, name: row.name, knownGoodEmail: row.known_good_email, knownGoodBankLast4: row.known_good_bank_last4, historicalPayments: JSON.parse(row.historical_payments), firstSeenDate: row.first_seen_date, isSoleSource: Boolean(row.is_sole_source) });
const parseAssessment = (row: any): RiskAssessment => ({ paymentRequestId: row.payment_request_id, riskScore: row.risk_score, verdict: row.verdict, confidence: row.confidence, primaryReason: row.primary_reason, signals: JSON.parse(row.signals), recommendedAction: row.recommended_action, rationale: row.rationale, deterministicFlags: JSON.parse(row.deterministic_flags), createdAt: row.created_at });

export function getQueue(): QueueItem[] {
  const rows = db.prepare(`SELECT p.*, v.*, p.id AS payment_id, v.id AS vendor_key, a.*, r.paypal_ref FROM payment_requests p JOIN vendors v ON v.id=p.vendor_id LEFT JOIN risk_assessments a ON a.payment_request_id=p.id LEFT JOIN release_results r ON r.payment_request_id=p.id ORDER BY v.name, p.submitted_at`).all() as any[];
  return rows.map((row) => {
    const assessment = row.payment_request_id ? parseAssessment(row) : null;
    return { id: row.payment_id, vendorId: row.vendor_id, invoiceNumber: row.invoice_number, amount: row.amount, payeeEmail: row.payee_email, payeeBankLast4: row.payee_bank_last4, requestEmailText: row.request_email_text, submittedAt: row.submitted_at, status: row.status, humanOverride: row.human_override, initiatedBy: row.payment_id === "p-005" ? "Procurement Agent" : "AP Team", vendor: parseVendor({ ...row, id: row.vendor_key }), assessment, effectiveVerdict: row.human_override ?? assessment?.verdict ?? null, paypalRef: row.paypal_ref ?? null };
  });
}

export function pendingQueue() { return getQueue().filter((item) => item.status === "PENDING"); }

export function saveAssessment(assessment: RiskAssessment) {
  db.prepare(`INSERT INTO risk_assessments VALUES (@paymentRequestId,@riskScore,@verdict,@confidence,@primaryReason,@signals,@recommendedAction,@rationale,@deterministicFlags,@createdAt) ON CONFLICT(payment_request_id) DO UPDATE SET risk_score=excluded.risk_score, verdict=excluded.verdict, confidence=excluded.confidence, primary_reason=excluded.primary_reason, signals=excluded.signals, recommended_action=excluded.recommended_action, rationale=excluded.rationale, deterministic_flags=excluded.deterministic_flags, created_at=excluded.created_at`).run({ ...assessment, signals: JSON.stringify(assessment.signals), deterministicFlags: JSON.stringify(assessment.deterministicFlags) });
}

export function setOverride(id: string, verdict: "RELEASE" | "HOLD") { db.prepare("UPDATE payment_requests SET human_override=? WHERE id=? AND status='PENDING'").run(verdict, id); }
export function setStatus(id: string, status: string) { db.prepare("UPDATE payment_requests SET status=? WHERE id=?").run(status, id); }
export function saveRelease(id: string, paypalRef: string, batchRef: string | null, state: string, raw: unknown) { db.prepare("INSERT OR REPLACE INTO release_results VALUES (?, ?, ?, ?, ?, ?)").run(id, paypalRef, batchRef, state, JSON.stringify(raw), new Date().toISOString()); }
export function findByProviderRef(ref: string) { return db.prepare("SELECT payment_request_id FROM release_results WHERE paypal_ref=? OR capture_ref=?").get(ref, ref) as { payment_request_id: string } | undefined; }

export type PayoutAssignment = { paymentId: string; recipientEmail: string };
export type PayoutBatchRecord = { fingerprint: string; request_id: string; payout_batch_id: string | null; state: string; baseline: string | null };
export type PayoutItemRecord = { payment_request_id: string; batch_fingerprint: string; payout_item_id: string | null; recipient_email: string; state: string };

const createPayoutClaim = db.transaction((fingerprint: string, requestId: string, assignments: PayoutAssignment[]) => {
  const now = new Date().toISOString();
  const created = db.prepare("INSERT OR IGNORE INTO payout_batches VALUES (?, ?, NULL, 'CLAIMED', NULL, ?, ?)").run(fingerprint, requestId, now, now).changes === 1;
  const insertItem = db.prepare("INSERT OR IGNORE INTO payout_items VALUES (?, ?, NULL, ?, 'CLAIMED', '{}', ?)");
  for (const assignment of assignments) insertItem.run(assignment.paymentId, fingerprint, assignment.recipientEmail, now);
  return created;
});

export function beginPayoutBatch(fingerprint: string, requestId: string, assignments: PayoutAssignment[]) { return createPayoutClaim(fingerprint, requestId, assignments); }
export function hasPayoutItem(paymentId: string) { return Boolean(db.prepare("SELECT 1 FROM payout_items WHERE payment_request_id=?").get(paymentId)); }
export function getPayoutBatch(fingerprint: string) { return db.prepare("SELECT * FROM payout_batches WHERE fingerprint=?").get(fingerprint) as PayoutBatchRecord | undefined; }
export function getPayoutItems(fingerprint: string) { return db.prepare("SELECT * FROM payout_items WHERE batch_fingerprint=? ORDER BY payment_request_id").all(fingerprint) as PayoutItemRecord[]; }
export function listOpenPayoutBatches() { return db.prepare("SELECT * FROM payout_batches WHERE payout_batch_id IS NOT NULL AND state NOT IN ('SUCCESS','DENIED','CANCELED')").all() as PayoutBatchRecord[]; }

export function updatePayoutBatch(fingerprint: string, batchId: string | null, state: string, baseline?: unknown) {
  db.prepare("UPDATE payout_batches SET payout_batch_id=COALESCE(?,payout_batch_id), state=?, baseline=COALESCE(?,baseline), updated_at=? WHERE fingerprint=?").run(batchId, state, baseline === undefined ? null : JSON.stringify(baseline), new Date().toISOString(), fingerprint);
}

export function recordPayoutItem(paymentId: string, batchId: string, payoutItemId: string | null, state: string, raw: unknown) {
  const now = new Date().toISOString();
  const reference = payoutItemId || batchId;
  const status = state === "SUCCESS" ? "SETTLED" : ["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED"].includes(state) ? "FAILED" : "PROCESSING";
  db.transaction(() => {
    db.prepare("UPDATE payout_items SET payout_item_id=COALESCE(?,payout_item_id), state=?, raw=?, updated_at=? WHERE payment_request_id=?").run(payoutItemId, state, JSON.stringify(raw), now, paymentId);
    saveRelease(paymentId, reference, batchId, state, raw);
    setStatus(paymentId, status);
  })();
}

export function markSandboxPending(paymentId: string, reference: string, reason: string) {
  saveRelease(paymentId, reference, null, "SANDBOX_PENDING", { reason });
  setStatus(paymentId, "PROCESSING");
}

export function updatePayoutByProviderRef(ref: string, state: string, raw: unknown) {
  const item = db.prepare("SELECT pi.*, pb.payout_batch_id FROM payout_items pi JOIN payout_batches pb ON pb.fingerprint=pi.batch_fingerprint WHERE pi.payout_item_id=?").get(ref) as (PayoutItemRecord & { payout_batch_id: string | null }) | undefined;
  if (!item) return false;
  recordPayoutItem(item.payment_request_id, item.payout_batch_id || item.batch_fingerprint, ref, state, raw);
  return true;
}

export function updatePayoutByPaymentId(paymentId: string, payoutItemId: string | null, state: string, raw: unknown) {
  const item = db.prepare("SELECT pi.*, pb.payout_batch_id FROM payout_items pi JOIN payout_batches pb ON pb.fingerprint=pi.batch_fingerprint WHERE pi.payment_request_id=?").get(paymentId) as (PayoutItemRecord & { payout_batch_id: string | null }) | undefined;
  if (!item) return false;
  recordPayoutItem(paymentId, item.payout_batch_id || item.batch_fingerprint, payoutItemId || item.payout_item_id, state, raw);
  return true;
}

function isFraudHold(payment: QueueItem) {
  if (payment.effectiveVerdict !== "HOLD" || !payment.assessment) return false;
  const evidence = [...payment.assessment.deterministicFlags, ...payment.assessment.signals];
  return evidence.some((signal) => ["DUPLICATE_INVOICE", "PAYEE_CHANGED", "AMOUNT_ANOMALY", "URGENT_ACCOUNT_CHANGE_LANGUAGE", "NEW_VENDOR_HIGH_VALUE"].includes(signal));
}

export function resultsSummary() {
  const queue = getQueue();
  const released = queue.filter((payment) => payment.status === "SETTLED" || payment.status === "RELEASED");
  const blocked = queue.filter(isFraudHold);
  return { releasedAmount: released.reduce((sum, payment) => sum + payment.amount, 0), releasedCount: released.length, blockedAmount: blocked.reduce((sum, payment) => sum + payment.amount, 0), blockedCount: blocked.length, queue };
}

export function injectAttack() {
  const id = `p-attack-${Date.now()}`;
  const invoice = `AC-${Math.floor(30000 + Math.random() * 60000)}`;
  db.prepare("INSERT INTO payment_requests VALUES (?, 'v-acme', ?, 36750, ?, '1048', ?, ?, 'PENDING', NULL)").run(id, invoice, `acme.payments.${Math.floor(Math.random() * 900 + 100)}@gmail.com`, "CONFIDENTIAL and urgent: our settlement account changed this morning. Pay today to avoid immediate service suspension and a late penalty.", new Date().toISOString());
  return id;
}

export default db;
