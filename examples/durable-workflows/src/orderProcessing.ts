/**
 * Workflow 1: Order Processing
 *
 * Steps:
 *   1. validateOrder   – checks the order input is valid
 *   2. chargeCustomer  – simulates a payment charge (side-effect)
 *   3. sleep           – wait 100 ms (simulates "processing delay")
 *   4. waitForSignal   – waits for external PaymentConfirmed signal
 *   5. shipOrder       – marks the order as shipped
 *
 * Demonstrates: ctx.step(), ctx.sleep(), ctx.waitForSignal(), signals.
 */
import { r } from "@bluelibs/runner/node";
import { durable, PaymentConfirmed } from "./ids.js";

export interface OrderInput {
  orderId: string;
  customerId: string;
  amount: number;
}

export interface OrderResult {
  orderId: string;
  transactionId: string;
  status: "shipped";
  shippedAt: number;
}

export const processOrder = r
  .task("example.tasks.processOrder")
  .dependencies({ durable })
  .run(async (input: OrderInput, { durable }): Promise<OrderResult> => {
    const ctx = durable.use();

    // Step 1 — validate
    const validated = await ctx.step("validateOrder", async () => {
      if (!input.orderId || input.amount <= 0) {
        throw new Error("Invalid order");
      }
      return {
        orderId: input.orderId,
        customerId: input.customerId,
        amount: input.amount,
        validatedAt: Date.now(),
      };
    });

    // Step 2 — charge
    const charge = await ctx.step("chargeCustomer", async () => {
      // Simulate calling a payment gateway
      return {
        chargeId: `chg_${validated.orderId}_${Date.now()}`,
        charged: validated.amount,
      };
    });

    // Step 3 — durable sleep (survives restarts)
    await ctx.sleep(100);

    // Step 4 — wait for external payment confirmation (signal)
    const confirmation = await ctx.waitForSignal(PaymentConfirmed, {
      stepId: "awaitPaymentConfirmation",
    });

    // Step 5 — ship
    const shipment = await ctx.step("shipOrder", async () => {
      return {
        orderId: validated.orderId,
        transactionId: confirmation.transactionId,
        status: "shipped" as const,
        shippedAt: Date.now(),
      };
    });

    await ctx.note(`Order ${validated.orderId} shipped via charge ${charge.chargeId}`);

    return shipment;
  })
  .build();
