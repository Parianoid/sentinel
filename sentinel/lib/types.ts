export type PaymentStatus = "PENDING" | "RELEASED" | "SETTLED" | "HELD" | "ESCALATED" | "FAILED" | "PROCESSING";
export type Verdict = "RELEASE" | "HOLD" | "ESCALATE";

export interface Vendor {
  id: string;
  name: string;
  knownGoodEmail: string;
  knownGoodBankLast4: string;
  historicalPayments: number[];
  firstSeenDate: string;
  isSoleSource: boolean;
}

export interface PaymentRequest {
  id: string;
  vendorId: string;
  invoiceNumber: string;
  amount: number;
  payeeEmail: string;
  payeeBankLast4: string;
  requestEmailText: string;
  submittedAt: string;
  status: PaymentStatus;
  humanOverride: Verdict | null;
  initiatedBy?: "AP Team" | "Procurement Agent";
}

export interface RiskAssessment {
  paymentRequestId: string;
  riskScore: number;
  verdict: Verdict;
  confidence: number;
  primaryReason: string;
  signals: string[];
  recommendedAction: string;
  rationale: string;
  deterministicFlags: string[];
  createdAt: string;
}

export interface QueueItem extends PaymentRequest {
  vendor: Vendor;
  assessment: RiskAssessment | null;
  effectiveVerdict: Verdict | null;
  paypalRef: string | null;
}
