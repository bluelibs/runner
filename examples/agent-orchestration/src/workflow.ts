import { r } from "@bluelibs/runner";
import { resources, tags } from "@bluelibs/runner/node";

import {
  ComplianceDecision,
  ReviewDecision,
  RevisedDraft,
  StressPolicyDecision,
  StressRevisionDraft,
} from "./signals.js";

export interface AgentResearchInput {
  topic: string;
  failAt?: "evidence";
}

export interface StressAgentInput {
  topic: string;
  lane: "fast" | "careful" | "regulated";
  failAt?: "evidence";
}

export interface ResearchDraft {
  topic: string;
  version: number;
  summary: string;
  plan: string[];
  evidence: string[];
}

export interface StressDraft {
  topic: string;
  lane: StressAgentInput["lane"];
  version: number;
  summary: string;
  evidence: string[];
  policyNotes: string[];
}

interface StressLanePlan {
  evidence: string[];
  maxPolicyRounds: number;
  requiresCompliance: boolean;
}

export type AgentResearchResult =
  | {
      status: "published";
      draft: ResearchDraft;
      publishedBy: string;
      publishedAt: number;
    }
  | {
      status: "timed_out";
      phase: "review" | "revision";
      round: number;
      draft: ResearchDraft;
    }
  | {
      status: "needs_human_help";
      reason: "max_revision_rounds";
      draft: ResearchDraft;
    };

export type StressAgentResult =
  | {
      status: "published";
      lane: StressAgentInput["lane"];
      draft: StressDraft;
      revisionCount: number;
      publishedBy: string;
      publishedAt: number;
    }
  | {
      status: "aborted";
      lane: StressAgentInput["lane"];
      draft: StressDraft;
      revisionCount: number;
      reason:
        | "policy_abort"
        | "policy_timeout"
        | "revision_timeout"
        | "revision_budget_exhausted";
      revertedSteps: string[];
    }
  | {
      status: "rejected";
      lane: StressAgentInput["lane"];
      draft: StressDraft;
      revisionCount: number;
      rejectedBy: string;
      revertedSteps: string[];
    };

export type DurableDefinition =
  | ReturnType<typeof resources.memoryWorkflow.fork>
  | ReturnType<typeof resources.redisWorkflow.fork>;

const MaxRevisionRounds = 2;

const evidenceProviderFailed = r
  .error("evidenceProviderFailed")
  .dataSchema({ topic: String })
  .build();

const stressEvidenceProviderFailed = r
  .error("stressEvidenceProviderFailed")
  .dataSchema({ lane: String, topic: String })
  .build();

export interface WorkflowTimingOptions {
  reviewTimeoutMs?: number;
  revisionTimeoutMs?: number;
}

export function createResearchAgentWorkflow(
  durable: DurableDefinition,
  options?: WorkflowTimingOptions,
) {
  const reviewTimeoutMs = options?.reviewTimeoutMs ?? 2_000;
  const revisionTimeoutMs = options?.revisionTimeoutMs ?? 2_000;

  return r
    .task("researchAgentWorkflow")
    .dependencies({ durable })
    .tags([
      tags.durableWorkflow.with({
        category: "agents",
        signals: [ReviewDecision, RevisedDraft],
      }),
    ])
    .run(
      async (
        input: AgentResearchInput,
        { durable },
      ): Promise<AgentResearchResult> => {
        const durableContext = durable.use();

        const plan = await durableContext.step("plan-research", async () => {
          return [
            `understand:${input.topic}`,
            `research:${input.topic}`,
            `summarize:${input.topic}`,
          ];
        });

        const evidence = await durableContext.step(
          "collect-evidence",
          async () => {
            if (input.failAt === "evidence") {
              throw evidenceProviderFailed.new({ topic: input.topic });
            }

            return [`note:${input.topic}`, `search:${input.topic}`];
          },
        );

        let draft = await durableContext.step("draft-v1", async () => {
          return {
            topic: input.topic,
            version: 1,
            summary: `Initial brief for ${input.topic}`,
            plan,
            evidence,
          } satisfies ResearchDraft;
        });

        for (let round = 1; round <= MaxRevisionRounds; round += 1) {
          const review = await durableContext.waitForSignal(ReviewDecision, {
            stepId: `wait-review-${round}`,
            timeoutMs: reviewTimeoutMs,
          });

          if (!review || review.kind === "timeout") {
            return {
              status: "timed_out",
              phase: "review",
              round,
              draft,
            };
          }

          if (review.payload.decision === "approve") {
            const published = await durableContext.step(
              `publish-v${draft.version}`,
              async () => ({
                publishedBy: review.payload.reviewer,
                publishedAt: Date.now(),
              }),
            );

            return {
              status: "published",
              draft,
              ...published,
            };
          }

          await durableContext.note(
            `Revision requested in round ${round}: ${review.payload.feedback ?? "no feedback"}`,
          );

          const revision = await durableContext.waitForSignal(RevisedDraft, {
            stepId: `wait-revision-${round}`,
            timeoutMs: revisionTimeoutMs,
          });

          if (!revision || revision.kind === "timeout") {
            return {
              status: "timed_out",
              phase: "revision",
              round,
              draft,
            };
          }

          draft = await durableContext.step(
            `apply-revision-${round}`,
            async () => {
              return {
                ...draft,
                version: round + 1,
                summary: revision.payload.summary,
              } satisfies ResearchDraft;
            },
          );
        }

        return {
          status: "needs_human_help",
          reason: "max_revision_rounds",
          draft,
        };
      },
    )
    .build();
}

export function createStressAgentWorkflow(
  durable: DurableDefinition,
  options?: WorkflowTimingOptions,
) {
  const reviewTimeoutMs = options?.reviewTimeoutMs ?? 2_000;
  const revisionTimeoutMs = options?.revisionTimeoutMs ?? 2_000;

  return r
    .task("stressAgentWorkflow")
    .dependencies({ durable })
    .tags([
      tags.durableWorkflow.with({
        category: "agents",
        signals: [
          StressPolicyDecision,
          StressRevisionDraft,
          ComplianceDecision,
        ],
      }),
    ])
    .run(
      async (
        input: StressAgentInput,
        { durable },
      ): Promise<StressAgentResult> => {
        /**
         * Current durable context within a specific executionId.
         */
        const d = durable.use();
        const revertedSteps: string[] = [];

        await d.note(`Stress workflow started for ${input.topic}`);

        await d
          .step("reserve-budget")
          .up(async () => ({
            budgetId: `budget:${input.lane}:${input.topic}`,
            reservedAt: Date.now(),
          }))
          .down(async () => {
            revertedSteps.push("reserve-budget");
          });

        let lanePlan: StressLanePlan;

        try {
          lanePlan = await d.switch("route-lane", input.lane, [
            {
              id: "fast",
              match: (lane) => lane === "fast",
              run: async (): Promise<StressLanePlan> => {
                const evidence = await d.step(
                  "collect-fast-evidence",
                  async () => {
                    if (input.failAt === "evidence") {
                      throw stressEvidenceProviderFailed.new({
                        lane: input.lane,
                        topic: input.topic,
                      });
                    }

                    return [`faq:${input.topic}`, `notes:${input.topic}`];
                  },
                );

                return {
                  evidence,
                  maxPolicyRounds: 1,
                  requiresCompliance: false,
                };
              },
            },
            {
              id: "careful",
              match: (lane) => lane === "careful",
              run: async (): Promise<StressLanePlan> => {
                const evidence = await d.step(
                  "collect-careful-evidence",
                  async () => [
                    `search:${input.topic}`,
                    `benchmark:${input.topic}`,
                  ],
                );
                await d.step("fact-check-careful", async () => "checked");

                return {
                  evidence,
                  maxPolicyRounds: 2,
                  requiresCompliance: false,
                };
              },
            },
            {
              id: "regulated",
              match: (lane) => lane === "regulated",
              run: async (): Promise<StressLanePlan> => {
                const evidence = await d.step(
                  "collect-regulated-evidence",
                  async () => [`source:${input.topic}`, `audit:${input.topic}`],
                );
                await d.step("fact-check-regulated", async () => "checked");

                return {
                  evidence,
                  maxPolicyRounds: 2,
                  requiresCompliance: true,
                };
              },
            },
          ]);
        } catch (error) {
          await d.rollback();
          throw error;
        }

        let draft = await d
          .step<StressDraft>("draft-stress-v1")
          .up(async () => {
            return {
              topic: input.topic,
              lane: input.lane,
              version: 1,
              summary: `Initial ${input.lane} draft for ${input.topic}`,
              evidence: lanePlan.evidence,
              policyNotes: [],
            } satisfies StressDraft;
          })
          .down(async () => {
            revertedSteps.push("draft-stress-v1");
          });

        let revisionCount = 0;
        let approvedBy = "auto-approver";

        for (let round = 1; round <= lanePlan.maxPolicyRounds; round += 1) {
          const policy = await d.waitForSignal(StressPolicyDecision, {
            stepId: `wait-stress-policy-${round}`,
            timeoutMs: reviewTimeoutMs,
          });

          if (!policy || policy.kind === "timeout") {
            await d.rollback();
            return {
              status: "aborted",
              lane: input.lane,
              draft,
              revisionCount,
              reason: "policy_timeout",
              revertedSteps,
            };
          }

          if (policy.payload.decision === "abort") {
            await d.rollback();
            return {
              status: "aborted",
              lane: input.lane,
              draft,
              revisionCount,
              reason: "policy_abort",
              revertedSteps,
            };
          }

          if (policy.payload.decision === "approve") {
            approvedBy = policy.payload.reviewer;
            break;
          }

          if (round === lanePlan.maxPolicyRounds) {
            await d.rollback();
            return {
              status: "aborted",
              lane: input.lane,
              draft,
              revisionCount,
              reason: "revision_budget_exhausted",
              revertedSteps,
            };
          }

          const revision = await d.waitForSignal(StressRevisionDraft, {
            stepId: `wait-stress-revision-${round}`,
            timeoutMs: revisionTimeoutMs,
          });

          if (!revision || revision.kind === "timeout") {
            await d.rollback();
            return {
              status: "aborted",
              lane: input.lane,
              draft,
              revisionCount,
              reason: "revision_timeout",
              revertedSteps,
            };
          }

          revisionCount += 1;
          draft = await d.step<StressDraft>(
            `apply-stress-revision-${round}`,
            async () => {
              return {
                ...draft,
                version: draft.version + 1,
                summary: revision.payload.summary,
                policyNotes: [
                  ...draft.policyNotes,
                  policy.payload.feedback ?? "revise",
                ],
              } satisfies StressDraft;
            },
          );
        }

        if (lanePlan.requiresCompliance) {
          const compliance = await d.waitForSignal(ComplianceDecision, {
            stepId: "wait-compliance-decision",
            timeoutMs: reviewTimeoutMs,
          });

          if (
            !compliance ||
            compliance.kind === "timeout" ||
            compliance.payload.decision === "reject"
          ) {
            await d.rollback();
            return {
              status: "rejected",
              lane: input.lane,
              draft,
              revisionCount,
              rejectedBy:
                !compliance || compliance.kind === "timeout"
                  ? "compliance-timeout"
                  : compliance.payload.reviewer,
              revertedSteps,
            };
          }
        }

        const published = await d.step<{
          publishedBy: string;
          publishedAt: number;
        }>("publish-stress", async () => ({
          publishedBy: approvedBy,
          publishedAt: Date.now(),
        }));

        return {
          status: "published",
          lane: input.lane,
          draft,
          revisionCount,
          ...published,
        };
      },
    )
    .build();
}
