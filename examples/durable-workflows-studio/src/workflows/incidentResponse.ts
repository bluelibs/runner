/**
 * Workflow 3: Incident Response.
 *
 * The richest demo: two signal waits with timeouts, two replay-safe switches,
 * and an opt-in failure (`chaos: true`) so the studio can demonstrate the
 * operator actions (retry, force-fail) on a failed execution.
 *
 * triage → page → await ack ─┬─ acked ─→ diagnose → await approval ─┬─ approved ─→ remediate → verify ─┐
 *                            └─ timeout → escalate ─────────────────┴─ rejected ─→ (skip) ─────────────┴─→ close
 */
import { Match, r } from "@bluelibs/runner";
import { durableWorkflowTag } from "@bluelibs/runner/node";
import { durable } from "../server/studioIds.js";
import { ApprovalDecision, IncidentAcknowledged } from "./signals.js";

export interface IncidentInput {
  incidentId: string;
  severity: "SEV-1" | "SEV-2" | "SEV-3";
  summary: string;
  /** Ack wait timeout. Defaults to 20s. */
  ackTimeoutMs?: number;
  /** Approval wait timeout. Defaults to 30s. */
  approvalTimeoutMs?: number;
  /** When true, the diagnose step throws to simulate a broken runbook. */
  chaos?: boolean;
}

export interface IncidentResult {
  incidentId: string;
  outcome: "resolved" | "escalated" | "rejected";
  severity: string;
  closedAt: number;
}

export const incidentInputSchema = Match.compile({
  incidentId: Match.NonEmptyString,
  severity: Match.OneOf("SEV-1", "SEV-2", "SEV-3"),
  summary: Match.NonEmptyString,
  ackTimeoutMs: Match.Optional(Match.Range({ min: 0, integer: true })),
  approvalTimeoutMs: Match.Optional(
    Match.Range({ min: 0, integer: true }),
  ),
  chaos: Match.Optional(Boolean),
});

export const incidentResponse = r
  .task("incidentResponse")
  .inputSchema(incidentInputSchema)
  .tags([
    durableWorkflowTag.with({
      key: "incidentResponse",
      category: "reliability",
      signals: [IncidentAcknowledged, ApprovalDecision],
    }),
  ])
  .dependencies({ durable })
  .run(
    async (input: IncidentInput, { durable }): Promise<IncidentResult> => {
      const durableContext = durable.use();

      const triaged = await durableContext.step("triageAlert", async () => {
        if (!input.incidentId || !input.summary) {
          throw new Error("Invalid incident");
        }
        return {
          incidentId: input.incidentId,
          severity: input.severity,
          summary: input.summary,
          triagedAt: Date.now(),
        };
      });

      await durableContext.step("pageOnCall", async () => ({
        pagedAt: Date.now(),
        channel: triaged.severity === "SEV-1" ? "phone" : "slack",
      }));

      const ack = await durableContext.waitForSignal(IncidentAcknowledged, {
        stepId: "awaitAck",
        timeoutMs: input.ackTimeoutMs ?? 20_000,
      });

      const outcome = await durableContext.switch(
        "ackBranch",
        ack,
        [
          {
            id: "acked",
            match: (v: typeof ack) => v.kind === "signal",
            run: async () => {
              const diagnosis = await durableContext.step(
                "diagnose",
                async () => {
                  if (input.chaos) {
                    throw new Error("Runbook exploded (chaos mode)");
                  }
                  return {
                    rootCause: "saturated connection pool",
                    confidence: 0.86,
                    diagnosedAt: Date.now(),
                  };
                },
              );

              await durableContext.note(
                `Diagnosis for ${triaged.incidentId}: ${diagnosis.rootCause}`,
              );

              const approval = await durableContext.waitForSignal(
                ApprovalDecision,
                {
                  stepId: "awaitApproval",
                  timeoutMs: input.approvalTimeoutMs ?? 30_000,
                },
              );

              return await durableContext.switch(
                "approvalBranch",
                approval,
                [
                  {
                    id: "approved",
                    match: (v: typeof approval) =>
                      v.kind === "signal" && v.payload.approved === true,
                    run: async () => {
                      await durableContext.step("remediate", async () => ({
                        action: "drain and recycle pool",
                        remediatedAt: Date.now(),
                      }));
                      await durableContext.step("verifyRecovery", async () => ({
                        healthy: true,
                        verifiedAt: Date.now(),
                      }));
                      return "resolved" as const;
                    },
                  },
                  {
                    id: "rejected",
                    match: (v: typeof approval) =>
                      v.kind === "timeout" ||
                      (v.kind === "signal" && v.payload.approved === false),
                    run: async () => {
                      await durableContext.note(
                        "Remediation rejected — leaving manual follow-up",
                      );
                      return "rejected" as const;
                    },
                  },
                ],
              );
            },
          },
          {
            id: "timed-out",
            match: (v: typeof ack) => v.kind === "timeout",
            run: async () => {
              await durableContext.step("escalate", async () => ({
                escalatedTo: "incident-commander",
                escalatedAt: Date.now(),
              }));
              await durableContext.note(
                `No ack for ${triaged.incidentId} — escalated`,
              );
              return "escalated" as const;
            },
          },
        ],
      );

      await durableContext.step("closeIncident", async () => ({
        incidentId: triaged.incidentId,
        outcome,
        closedAt: Date.now(),
      }));

      return {
        incidentId: triaged.incidentId,
        outcome,
        severity: triaged.severity,
        closedAt: Date.now(),
      };
    },
  )
  .build();
