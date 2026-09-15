/**
 * Workflow 2: User Onboarding.
 *
 * create → verification email → wait for signal (with timeout) → replay-safe
 * branch (provision workspace vs skip) → welcome email.
 */
import { Match, r } from "@bluelibs/runner";
import { durableWorkflowTag } from "@bluelibs/runner/node";
import { durable } from "../server/studioIds.js";
import { EmailVerified } from "./signals.js";

export interface OnboardingInput {
  email: string;
  plan: "free" | "pro";
  /** Signal wait timeout. Defaults to 15s. */
  verificationTimeoutMs?: number;
}

export interface OnboardingResult {
  userId: string;
  email: string;
  plan: "free" | "pro";
  verified: boolean;
  workspace: string | null;
  completedAt: number;
}

export const onboardingInputSchema = Match.compile({
  email: Match.Email,
  plan: Match.OneOf("free", "pro"),
  verificationTimeoutMs: Match.Optional(
    Match.Range({ min: 0, integer: true }),
  ),
});

export const userOnboarding = r
  .task("userOnboarding")
  .inputSchema(onboardingInputSchema)
  .tags([
    durableWorkflowTag.with({
      key: "userOnboarding",
      category: "growth",
      signals: [EmailVerified],
    }),
  ])
  .dependencies({ durable })
  .run(
    async (input: OnboardingInput, { durable }): Promise<OnboardingResult> => {
      const durableContext = durable.use();

      const account = await durableContext.step("createAccount", async () => ({
        userId: `user_${Date.now()}`,
        email: input.email,
        plan: input.plan,
      }));

      await durableContext.note(`Account created for ${account.email}`);

      await durableContext.step("sendVerificationEmail", async () => ({
        sentTo: account.email,
        sentAt: Date.now(),
      }));

      const verification = await durableContext.waitForSignal(EmailVerified, {
        stepId: "awaitEmailVerification",
        timeoutMs: input.verificationTimeoutMs ?? 15_000,
      });

      const workspace: string | null = await durableContext.switch(
        "provisionBranch",
        verification,
        [
          {
            id: "verified",
            match: (v: typeof verification) => v.kind === "signal",
            run: async () =>
              await durableContext.step("provisionResources", async () => {
                await durableContext.note(
                  `Provisioning workspace for ${account.email}`,
                );
                return `workspace_${account.userId}`;
              }),
          },
          {
            id: "timed-out",
            match: (v: typeof verification) => v.kind === "timeout",
            run: async () => {
              await durableContext.note(
                "Email verification timed out — skipping provisioning",
              );
              return null;
            },
          },
        ],
      );

      await durableContext.step("sendWelcomeEmail", async () => ({
        sentTo: account.email,
        verified: verification.kind === "signal",
        sentAt: Date.now(),
      }));

      return {
        userId: account.userId,
        email: account.email,
        plan: account.plan,
        verified: verification.kind === "signal",
        workspace,
        completedAt: Date.now(),
      };
    },
  )
  .build();
