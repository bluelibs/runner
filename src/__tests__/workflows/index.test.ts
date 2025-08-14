/**
 * Integration tests for the complete workflow system
 */

import * as workflows from "../../workflows";
import { task, resource, run } from "../../index";
import { WorkflowStatus } from "../../workflows/defs";

describe("Workflows Module Integration", () => {
  describe("module exports", () => {
    it("should export all workflow components", () => {
      expect(typeof workflows.defineWorkflow).toBe("function");
      expect(typeof workflows.defineWorkflowStep).toBe("function");
      expect(typeof workflows.defineWorkflowTransition).toBe("function");
      expect(typeof workflows.defineWorkflowTimer).toBe("function");
      
      expect(typeof workflows.workflow).toBe("function");
      expect(typeof workflows.workflowStep).toBe("function");
      expect(typeof workflows.workflowTransition).toBe("function");
      expect(typeof workflows.workflowTimer).toBe("function");
      
      expect(workflows.WorkflowEngine).toBeDefined();
      expect(workflows.MemoryWorkflowAdapter).toBeDefined();
      expect(workflows.workflowResource).toBeDefined();
      expect(workflows.memoryWorkflowResource).toBeDefined();
      
      expect(workflows.WorkflowStatus).toBeDefined();
      expect(workflows.WorkflowStatus.PENDING).toBe("pending");
      expect(workflows.WorkflowStatus.COMPLETED).toBe("completed");
    });

    it("should have convenience aliases", () => {
      expect(workflows.workflow).toBe(workflows.defineWorkflow);
      expect(workflows.workflowStep).toBe(workflows.defineWorkflowStep);
      expect(workflows.workflowTransition).toBe(workflows.defineWorkflowTransition);
      expect(workflows.workflowTimer).toBe(workflows.defineWorkflowTimer);
    });
  });

  describe("complete real-world example", () => {
    it("should handle complex order processing workflow", async () => {
      // Business logic tasks
      const validateOrderTask = task({
        id: "business.validateOrder",
        run: async (orderData: {
          orderId: string;
          items: Array<{ id: string; quantity: number; price: number }>;
          customerEmail: string;
        }) => {
          if (!orderData.orderId || !orderData.customerEmail) {
            throw new Error("Missing required order information");
          }
          
          if (orderData.items.length === 0) {
            throw new Error("Order must contain at least one item");
          }
          
          const total = orderData.items.reduce(
            (sum, item) => sum + (item.quantity * item.price), 
            0
          );
          
          return {
            valid: true,
            total,
            itemCount: orderData.items.length,
          };
        },
      });

      const checkInventoryTask = task({
        id: "business.checkInventory",
        run: async (orderData: any) => {
          // Simulate inventory check
          const unavailableItems = orderData.items.filter(
            (item: any) => item.quantity > 10 // Simulate out of stock
          );
          
          if (unavailableItems.length > 0) {
            throw new Error(`Items out of stock: ${unavailableItems.map((i: any) => i.id).join(", ")}`);
          }
          
          return {
            inventoryChecked: true,
            reservedItems: orderData.items.map((item: any) => ({
              ...item,
              reservationId: `res_${Math.random().toString(36).substr(2, 9)}`,
            })),
          };
        },
      });

      const processPaymentTask = task({
        id: "business.processPayment",
        run: async (paymentData: { total: number; customerEmail: string; paymentMethod: string }) => {
          if (paymentData.total <= 0) {
            throw new Error("Invalid payment amount");
          }
          
          if (paymentData.total > 1000) {
            throw new Error("Payment amount exceeds limit");
          }
          
          // Simulate payment processing
          return {
            paymentId: `pay_${Math.random().toString(36).substr(2, 9)}`,
            amount: paymentData.total,
            status: "completed",
            transactionDate: new Date().toISOString(),
          };
        },
      });

      const sendNotificationTask = task({
        id: "business.sendNotification",
        run: async (notificationData: { 
          customerEmail: string; 
          orderId: string; 
          type: "confirmation" | "shipped" | "delivered" 
        }) => {
          // Simulate sending notification
          return {
            notificationId: `notif_${Math.random().toString(36).substr(2, 9)}`,
            sent: true,
            type: notificationData.type,
            recipient: notificationData.customerEmail,
          };
        },
      });

      // Rollback tasks
      const releaseInventoryTask = task({
        id: "business.releaseInventory",
        run: async (inventoryData: any) => {
          // Simulate releasing reserved inventory
          console.log("Released inventory:", inventoryData.reservedItems?.map((item: any) => item.reservationId) || []);
        },
      });

      const refundPaymentTask = task({
        id: "business.refundPayment",
        run: async (paymentData: any) => {
          // Simulate refund
          console.log("Refunded payment:", paymentData.paymentId, "amount:", paymentData.amount);
        },
      });

      // Define workflow steps
      const validateStep = workflows.workflowStep({
        id: "validate",
        name: "Validate Order",
        task: validateOrderTask,
        config: { timeout: 5000, retries: 2 },
      });

      const inventoryStep = workflows.workflowStep({
        id: "inventory",
        name: "Check Inventory",
        task: checkInventoryTask,
        rollbackTask: releaseInventoryTask,
        config: { timeout: 10000, rollbackable: true },
      });

      const paymentStep = workflows.workflowStep({
        id: "payment",
        name: "Process Payment",
        task: processPaymentTask,
        rollbackTask: refundPaymentTask,
        config: { timeout: 30000, rollbackable: true },
      });

      const notificationStep = workflows.workflowStep({
        id: "notification",
        name: "Send Confirmation",
        task: sendNotificationTask,
        config: { timeout: 5000, retries: 3 },
      });

      // Define workflow transitions
      const transitions = [
        workflows.workflowTransition({
          from: "pending",
          to: "validated",
          steps: ["validate"],
        }),
        workflows.workflowTransition({
          from: "validated",
          to: "inventory_checked",
          steps: ["inventory"],
        }),
        workflows.workflowTransition({
          from: "inventory_checked",
          to: "paid",
          steps: ["payment"],
          condition: async (context, stepOutputs) => {
            const validationResult = stepOutputs?.validate;
            return validationResult?.total > 0;
          },
        }),
        workflows.workflowTransition({
          from: "paid",
          to: "confirmed",
          steps: ["notification"],
        }),
        workflows.workflowTransition({
          from: "confirmed",
          to: "completed",
        }),
        workflows.workflowTransition({
          from: "paid",
          to: "failed",
          condition: async (context) => context.forceFailure === true,
        }),
      ];

      // Define timeout timer
      const timeoutTimer = workflows.workflowTimer({
        id: "processing_timeout",
        duration: 24 * 60 * 60 * 1000, // 24 hours
        targetState: "expired",
      });

      // Create complete workflow
      const orderWorkflow = workflows.workflow({
        id: "ecommerce.orderProcessing",
        name: "E-commerce Order Processing",
        description: "Complete order processing workflow with validation, inventory, payment, and notifications",
        initialState: "pending",
        states: [
          "pending",
          "validated", 
          "inventory_checked",
          "paid",
          "confirmed",
          "completed",
          "failed",
          "expired"
        ],
        steps: [validateStep, inventoryStep, paymentStep, notificationStep],
        transitions,
        timers: [timeoutTimer],
        finalStates: ["completed", "failed", "expired"],
      });

      // Create application
      const app = resource({
        id: "ecommerce.orderProcessingApp",
        register: [
          workflows.memoryWorkflowResource,
          validateOrderTask,
          checkInventoryTask,
          processPaymentTask,
          sendNotificationTask,
          releaseInventoryTask,
          refundPaymentTask,
        ],
        dependencies: { 
          workflows: workflows.memoryWorkflowResource as any,
        },
        init: async (_: any, { workflows: workflowService }: any) => {
          // Register the workflow
          await workflowService.registerWorkflow(orderWorkflow);

          // Create test order
          const orderData = {
            orderId: "order_12345",
            customerEmail: "customer@example.com",
            paymentMethod: "credit_card",
            items: [
              { id: "item1", quantity: 2, price: 29.99 },
              { id: "item2", quantity: 1, price: 49.99 },
            ],
          };

          // Process the order
          const instance = await workflowService.createInstance(
            "ecommerce.orderProcessing",
            orderData
          );

          // Execute workflow steps
          const results: any = {};

          // Step 1: Validate order
          let success = await workflowService.transitionTo(instance.id, "validated");
          expect(success).toBe(true);
          
          let history = await workflowService.getExecutionHistory(instance.id);
          results.validation = history.find((h: any) => h.stepId === "validate")?.output;
          expect(results.validation.valid).toBe(true);
          expect(results.validation.total).toBe(109.97); // 2*29.99 + 1*49.99

          // Step 2: Check inventory
          success = await workflowService.transitionTo(instance.id, "inventory_checked");
          expect(success).toBe(true);
          
          history = await workflowService.getExecutionHistory(instance.id);
          results.inventory = history.find((h: any) => h.stepId === "inventory")?.output;
          expect(results.inventory.inventoryChecked).toBe(true);
          expect(results.inventory.reservedItems).toHaveLength(2);

          // Step 3: Process payment
          success = await workflowService.transitionTo(instance.id, "paid", {
            validate: results.validation,
          });
          expect(success).toBe(true);
          
          history = await workflowService.getExecutionHistory(instance.id);
          results.payment = history.find((h: any) => h.stepId === "payment")?.output;
          expect(results.payment.status).toBe("completed");
          expect(results.payment.amount).toBe(109.97);

          // Step 4: Send notification
          success = await workflowService.transitionTo(instance.id, "confirmed");
          expect(success).toBe(true);
          
          history = await workflowService.getExecutionHistory(instance.id);
          results.notification = history.find((h: any) => h.stepId === "notification")?.output;
          expect(results.notification.sent).toBe(true);
          expect(results.notification.type).toBe("confirmation");

          // Step 5: Complete order
          success = await workflowService.transitionTo(instance.id, "completed");
          expect(success).toBe(true);

          // Verify final state
          const finalInstance = await workflowService.getInstance(instance.id);
          expect(finalInstance?.currentState).toBe("completed");
          expect(finalInstance?.status).toBe(WorkflowStatus.COMPLETED);
          expect(finalInstance?.completedAt).toBeInstanceOf(Date);

          // Verify execution history
          const finalHistory = await workflowService.getExecutionHistory(instance.id);
          expect(finalHistory).toHaveLength(4); // All steps executed
          expect(finalHistory.every((h: any) => h.status === "completed")).toBe(true);

          return {
            orderId: orderData.orderId,
            instanceId: instance.id,
            finalState: finalInstance?.currentState,
            executionCount: finalHistory.length,
            results,
          };
        },
      });

      // Run the application
      const { value, dispose } = await run(app);

      expect((value as any).orderId).toBe("order_12345");
      expect((value as any).finalState).toBe("completed");
      expect((value as any).executionCount).toBe(4);
      expect((value as any).results.validation.total).toBe(109.97);
      expect((value as any).results.payment.status).toBe("completed");
      expect((value as any).results.notification.sent).toBe(true);

      await dispose();
    });

    it("should handle workflow rollback in case of failures", async () => {
      const successfulTask = task({
        id: "successful.task",
        run: async (input: any) => ({ success: true, data: input }),
      });

      const failingTask = task({
        id: "failing.task",
        run: async (): Promise<any> => {
          throw new Error("Simulated failure");
        },
      });

      const rollbackTask1 = task({
        id: "rollback.task1",
        run: async (output: any) => {
          console.log("Rolling back task 1:", output);
        },
      });

      const rollbackTask2 = task({
        id: "rollback.task2", 
        run: async (output: any) => {
          console.log("Rolling back task 2:", output);
        },
      });

      const step1 = workflows.workflowStep({
        id: "step1",
        task: successfulTask,
        rollbackTask: rollbackTask1,
        config: { rollbackable: true },
      });

      const step2 = workflows.workflowStep({
        id: "step2", 
        task: successfulTask,
        rollbackTask: rollbackTask2,
        config: { rollbackable: true },
      });

      const step3 = workflows.workflowStep({
        id: "step3",
        task: failingTask,
      });

      const rollbackWorkflow = workflows.workflow({
        id: "rollback.test",
        initialState: "start",
        states: ["start", "step1_done", "step2_done", "step3_done", "failed"],
        steps: [step1, step2, step3],
        transitions: [
          { from: "start", to: "step1_done", steps: ["step1"] },
          { from: "step1_done", to: "step2_done", steps: ["step2"] },
          { from: "step2_done", to: "step3_done", steps: ["step3"] },
        ],
      });

      const app = resource({
        id: "rollback.app",
        register: [
          workflows.memoryWorkflowResource,
          successfulTask,
          failingTask,
          rollbackTask1,
          rollbackTask2,
        ],
        dependencies: { workflows: workflows.memoryWorkflowResource as any },
        init: async (_: any, { workflows: workflowService }: any) => {
          await workflowService.registerWorkflow(rollbackWorkflow);

          const instance = await workflowService.createInstance("rollback.test", {
            testData: "rollback test",
          });

          // Execute successful steps
          await workflowService.transitionTo(instance.id, "step1_done");
          await workflowService.transitionTo(instance.id, "step2_done");

          // Attempt failing step
          const success = await workflowService.transitionTo(instance.id, "step3_done");
          expect(success).toBe(false); // Should fail

          // Verify we're still in step2_done state
          let currentInstance = await workflowService.getInstance(instance.id);
          expect(currentInstance?.currentState).toBe("step2_done");

          // Execute rollback
          const rollbackSuccess = await workflowService.rollback(instance.id);
          expect(rollbackSuccess).toBe(true);

          // Verify rollback completed
          currentInstance = await workflowService.getInstance(instance.id);
          expect(currentInstance?.currentState).toBe("start");
          expect(currentInstance?.status).toBe(WorkflowStatus.PENDING);

          // Verify rollback executions were recorded
          const history = await workflowService.getExecutionHistory(instance.id);
          const rollbackExecutions = history.filter((h: any) => h.isRollback);
          expect(rollbackExecutions).toHaveLength(2); // step2 and step1 rollbacks

          return {
            instanceId: instance.id,
            rollbackExecutions: rollbackExecutions.length,
            finalState: currentInstance?.currentState,
          };
        },
      });

      const { value, dispose } = await run(app);

      expect((value as any).rollbackExecutions).toBe(2);
      expect((value as any).finalState).toBe("start");

      await dispose();
    });
  });
});