import { r } from "@bluelibs/runner";
import {
  durableResource,
  MemoryStore,
  MemoryEventBus,
} from "@bluelibs/runner/node";

import type { OrderResult } from "./orderProcessing.js";
import type { OnboardingResult } from "./userOnboarding.js";
import { waitForSignalCheckpoint as waitForSignalCheckpointWithOptions } from "./signalCheckpoint.js";

export enum Namespace {
  Order = "order",
  OnboardingVerified = "onboardingVerified",
  OnboardingTimeout = "onboardingTimeout",
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

export const PaymentConfirmed = r
  .event<{ transactionId: string }>("paymentConfirmed")
  .build();

export const EmailVerified = r
  .event<{ verifiedAt: number }>("emailVerified")
  .build();

function createDurableSetup() {
  const store = new MemoryStore();
  const durable = durableResource.fork("durable");
  const durableRegistration = durable.with({
    store,
    eventBus: new MemoryEventBus(),
    polling: { interval: IntervalMs.WorkerPolling },
    recovery: { onStartup: true },
  });
  return { store, durable, durableRegistration };
}

export function buildOrderApp(ns: string) {
  const { store, durable, durableRegistration } = createDurableSetup();
  const processOrder = r
    .task("processOrder")
    .dependencies({ durable })
    .run(
      async (
        input: { orderId: string; customerId: string; amount: number },
        { durable },
      ) => {
        const durableContext = durable.use();

        const validated = await durableContext.step("validateOrder", async () => {
          if (!input.orderId || input.amount <= 0) {
            throw new Error("Invalid order");
          }
          return {
            orderId: input.orderId,
            customerId: input.customerId,
            amount: input.amount,
          };
        });

        const charge = await durableContext.step("chargeCustomer", async () => ({
          chargeId: `chg_${validated.orderId}`,
          charged: validated.amount,
        }));

        await durableContext.sleep(50);

        const confirmation = await durableContext.waitForSignal(PaymentConfirmed, {
          stepId: "awaitPaymentConfirmation",
        });

        const shipment = await durableContext.step("shipOrder", async () => ({
          orderId: validated.orderId,
          transactionId: confirmation.payload.transactionId,
          status: "shipped" as const,
          shippedAt: Date.now(),
        }));

        await durableContext.note(
          `Order ${validated.orderId} shipped via charge ${charge.chargeId}`,
        );
        return shipment;
      },
    )
    .build();

  const app = r
    .resource(ns)
    .register([durableRegistration, processOrder, PaymentConfirmed])
    .build();

  return { app, durable, store, processOrder };
}

export function buildOnboardingApp(ns: string, signalTimeoutMs: number) {
  const { store, durable, durableRegistration } = createDurableSetup();

  const userOnboarding = r
    .task("userOnboarding")
    .dependencies({ durable })
    .run(
      async (input: { email: string; plan: "free" | "pro" }, { durable }) => {
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
          timeoutMs: signalTimeoutMs,
        });

        const workspace: string | null = await durableContext.switch(
          "provisionBranch",
          verification,
          [
            {
              id: "verified",
              match: (v: typeof verification) => v.kind === "signal",
              run: async () => {
                return await durableContext.step("provisionResources", async () => {
                  return `workspace_${account.userId}`;
                });
              },
            },
            {
              id: "timed-out",
              match: (v: typeof verification) => v.kind === "timeout",
              run: async () => {
                await durableContext.note("Email verification timed out");
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
        } satisfies OnboardingResult;
      },
    )
    .build();

  const app = r
    .resource(ns)
    .register([durableRegistration, userOnboarding, EmailVerified])
    .build();

  return { app, durable, store, userOnboarding };
}

export async function waitForSignalCheckpoint(params: {
  store: MemoryStore;
  executionId: string;
  signalId: string;
}): Promise<void> {
  await waitForSignalCheckpointWithOptions({
    ...params,
    timeoutMs: TimeoutMs.SignalWait,
    intervalMs: IntervalMs.WaitPolling,
  });
}

export type OrderWorkflowResult = OrderResult;
export type OnboardingWorkflowResult = OnboardingResult;
