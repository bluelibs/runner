import { r, event } from "@bluelibs/runner";
import {
  waitUntil,
  durableResource,
  MemoryStore,
  MemoryEventBus,
} from "@bluelibs/runner/node";

import type { OrderResult } from "./orderProcessing.js";
import type { OnboardingResult } from "./userOnboarding.js";

export enum Namespace {
  Order = "durable.tests.order",
  OnboardingVerified = "durable.tests.onboarding.verified",
  OnboardingTimeout = "durable.tests.onboarding.timeout",
}

export enum TimeoutMs {
  SignalWait = 5_000,
  ExecutionWait = 10_000,
  OnboardingLong = 15_000,
  OnboardingShort = 200,
}

export enum IntervalMs {
  WorkerPolling = 10,
  WaitPolling = 10,
}

export const PaymentConfirmed = event<{ transactionId: string }>({
  id: "durable.tests.signals.paymentConfirmed",
});

export const EmailVerified = event<{ verifiedAt: number }>({
  id: "durable.tests.signals.emailVerified",
});

function createDurableSetup(ns: string) {
  const store = new MemoryStore();
  const durable = durableResource.fork(`${ns}.durable`);
  const durableRegistration = durable.with({
    store,
    eventBus: new MemoryEventBus(),
    worker: true,
    polling: { interval: IntervalMs.WorkerPolling },
  });
  return { store, durable, durableRegistration };
}

export function buildOrderApp(ns: string) {
  const { store, durable, durableRegistration } = createDurableSetup(ns);
  const processOrder = r
    .task(`${ns}.tasks.processOrder`)
    .dependencies({ durable })
    .run(
      async (
        input: { orderId: string; customerId: string; amount: number },
        { durable },
      ) => {
        const ctx = durable.use();

        const validated = await ctx.step("validateOrder", async () => {
          if (!input.orderId || input.amount <= 0) {
            throw new Error("Invalid order");
          }
          return {
            orderId: input.orderId,
            customerId: input.customerId,
            amount: input.amount,
          };
        });

        const charge = await ctx.step("chargeCustomer", async () => ({
          chargeId: `chg_${validated.orderId}`,
          charged: validated.amount,
        }));

        await ctx.sleep(50);

        const confirmation = await ctx.waitForSignal(PaymentConfirmed, {
          stepId: "awaitPaymentConfirmation",
        });

        const shipment = await ctx.step("shipOrder", async () => ({
          orderId: validated.orderId,
          transactionId: confirmation.transactionId,
          status: "shipped" as const,
          shippedAt: Date.now(),
        }));

        await ctx.note(
          `Order ${validated.orderId} shipped via charge ${charge.chargeId}`,
        );
        return shipment;
      },
    )
    .build();

  const app = r
    .resource(`${ns}.app`)
    .register([durableRegistration, processOrder, PaymentConfirmed])
    .build();

  return { app, durable, store, processOrder };
}

export function buildOnboardingApp(ns: string, signalTimeoutMs: number) {
  const { store, durable, durableRegistration } = createDurableSetup(ns);

  const userOnboarding = r
    .task(`${ns}.tasks.userOnboarding`)
    .dependencies({ durable })
    .run(
      async (input: { email: string; plan: "free" | "pro" }, { durable }) => {
        const ctx = durable.use();

        const account = await ctx.step("createAccount", async () => ({
          userId: `user_${Date.now()}`,
          email: input.email,
          plan: input.plan,
        }));

        await ctx.note(`Account created for ${account.email}`);

        await ctx.step("sendVerificationEmail", async () => ({
          sentTo: account.email,
          sentAt: Date.now(),
        }));

        const verification = await ctx.waitForSignal(EmailVerified, {
          stepId: "awaitEmailVerification",
          timeoutMs: signalTimeoutMs,
        });

        const workspace: string | null = await ctx.switch(
          "provisionBranch",
          verification,
          [
            {
              id: "verified",
              match: (v: typeof verification) => v.kind === "signal",
              run: async () => {
                return await ctx.step("provisionResources", async () => {
                  return `workspace_${account.userId}`;
                });
              },
            },
            {
              id: "timed-out",
              match: (v: typeof verification) => v.kind === "timeout",
              run: async () => {
                await ctx.note("Email verification timed out");
                return null;
              },
            },
          ],
        );

        await ctx.step("sendWelcomeEmail", async () => ({
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
        } satisfies OnboardingResult;
      },
    )
    .build();

  const app = r
    .resource(`${ns}.app`)
    .register([durableRegistration, userOnboarding, EmailVerified])
    .build();

  return { app, durable, store, userOnboarding };
}

function getSignalWaitStepSignalId(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const candidate = result as { state?: unknown; signalId?: unknown };
  if (candidate.state !== "waiting") {
    return null;
  }

  return typeof candidate.signalId === "string" ? candidate.signalId : null;
}

export async function waitForSignalCheckpoint(params: {
  store: MemoryStore;
  executionId: string;
  signalId: string;
}): Promise<void> {
  await waitUntil(
    async () => {
      const steps = await params.store.listStepResults(params.executionId);
      return steps.some((stepResult) => {
        return getSignalWaitStepSignalId(stepResult.result) === params.signalId;
      });
    },
    {
      timeoutMs: TimeoutMs.SignalWait,
      intervalMs: IntervalMs.WaitPolling,
    },
  );
}

export type OrderWorkflowResult = OrderResult;
export type OnboardingWorkflowResult = OnboardingResult;
