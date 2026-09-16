/**
 * Durable signals used by the studio demo workflows.
 *
 * Signals are plain Runner events delivered to waiting executions through
 * `service.signal(executionId, signal, payload)`.
 */
import { Match, r } from "@bluelibs/runner";

export interface PaymentConfirmedPayload {
  transactionId: string;
}

export interface EmailVerifiedPayload {
  verifiedAt: number;
}

export interface IncidentAcknowledgedPayload {
  acknowledgedBy: string;
  acknowledgedAt: number;
}

export interface ApprovalDecisionPayload {
  approved: boolean;
  decidedBy: string;
  reason?: string;
}

export const paymentConfirmedPayloadSchema = Match.compile({
  transactionId: Match.NonEmptyString,
});

export const emailVerifiedPayloadSchema = Match.compile({
  verifiedAt: Match.Range({ min: 0, integer: true }),
});

export const incidentAcknowledgedPayloadSchema = Match.compile({
  acknowledgedBy: Match.NonEmptyString,
  acknowledgedAt: Match.Range({ min: 0, integer: true }),
});

export const approvalDecisionPayloadSchema = Match.compile({
  approved: Boolean,
  decidedBy: Match.NonEmptyString,
  reason: Match.Optional(Match.NonEmptyString),
});

/** Fired when a payment provider confirms a charge. */
export const PaymentConfirmed = r
  .event<PaymentConfirmedPayload>("paymentConfirmed")
  .payloadSchema(paymentConfirmedPayloadSchema)
  .build();

/** Fired when a user clicks the verification link in their email. */
export const EmailVerified = r
  .event<EmailVerifiedPayload>("emailVerified")
  .payloadSchema(emailVerifiedPayloadSchema)
  .build();

/** Fired when the on-call engineer acknowledges an incident. */
export const IncidentAcknowledged = r
  .event<IncidentAcknowledgedPayload>("incidentAcknowledged")
  .payloadSchema(incidentAcknowledgedPayloadSchema)
  .build();

/** Fired when a change approver decides on automated remediation. */
export const ApprovalDecision = r
  .event<ApprovalDecisionPayload>("approvalDecision")
  .payloadSchema(approvalDecisionPayloadSchema)
  .build();
