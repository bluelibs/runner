/**
 * Workflow 2: User Onboarding
 *
 * Steps:
 *   1. createAccount        – provisions the user record
 *   2. sendVerificationEmail – sends a "click to verify" email
 *   3. waitForSignal         – waits for EmailVerified signal (with timeout)
 *   4. provisionResources    – sets up workspace, storage, etc.
 *   5. sendWelcomeEmail      – sends a welcome message
 *
 * Demonstrates: ctx.step(), ctx.waitForSignal() with timeout,
 *               ctx.switch() (replay-safe branching), ctx.note().
 */
import { r } from "@bluelibs/runner";
import { durable, EmailVerified } from "./ids.js";

export interface OnboardingInput {
  email: string;
  plan: "free" | "pro";
}

export interface OnboardingResult {
  userId: string;
  email: string;
  plan: "free" | "pro";
  verified: boolean;
  workspace: string | null;
  completedAt: number;
}

export const userOnboarding = r
  .task("example.tasks.userOnboarding")
  .dependencies({ durable })
  .run(
    async (input: OnboardingInput, { durable }): Promise<OnboardingResult> => {
      const ctx = durable.use();

      // Step 1 — create account
      const account = await ctx.step("createAccount", async () => {
        const userId = `user_${Date.now()}`;
        return { userId, email: input.email, plan: input.plan };
      });

      await ctx.note(`Account created for ${account.email}`);

      // Step 2 — send verification email
      await ctx.step("sendVerificationEmail", async () => {
        // Simulate sending an email
        return { sentTo: account.email, sentAt: Date.now() };
      });

      // Step 3 — wait for email verification (15 second timeout for demo)
      const verification = await ctx.waitForSignal(EmailVerified, {
        stepId: "awaitEmailVerification",
        timeoutMs: 15_000,
      });

      // Step 4 — branch based on verification outcome
      const workspace: string | null = await ctx.switch(
        "provisionBranch",
        verification,
        [
          {
            id: "verified",
            match: (v: typeof verification) => v.kind === "signal",
            run: async () => {
              // Provision resources only if verified
              const ws = await ctx.step("provisionResources", async () => {
                return `workspace_${account.userId}`;
              });
              return ws;
            },
          },
          {
            id: "timed-out",
            match: (v: typeof verification) => v.kind === "timeout",
            run: async () => {
              await ctx.note(
                "Email verification timed out — skipping provisioning",
              );
              return null;
            },
          },
        ],
      );

      // Step 5 — send welcome email
      await ctx.step("sendWelcomeEmail", async () => {
        return {
          sentTo: account.email,
          verified: verification.kind === "signal",
          sentAt: Date.now(),
        };
      });

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
