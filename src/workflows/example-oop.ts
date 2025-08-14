/**
 * Complete example demonstrating the new OOP workflow pattern
 * 
 * This example shows how to create workflows using the new object-oriented
 * approach, similar to how Queue and Semaphore work in BlueLibs Runner.
 */

import { Workflow, workflowResource } from "../workflows";
import { task, resource, run } from "../index";

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

const processPaymentTask = task({
  id: "business.processPayment", 
  run: async (paymentData: { total: number; customerEmail: string }) => {
    if (paymentData.total <= 0) {
      throw new Error("Invalid payment amount");
    }
    
    // Simulate payment processing
    return {
      paymentId: `pay_${Math.random().toString(36).substr(2, 9)}`,
      amount: paymentData.total,
      status: "completed",
    };
  },
});

const refundPaymentTask = task({
  id: "business.refundPayment",
  run: async (paymentData: { paymentId: string; amount: number }) => {
    // Simulate refund processing
    return {
      refundId: `ref_${Math.random().toString(36).substr(2, 9)}`,
      originalPaymentId: paymentData.paymentId,
      amount: paymentData.amount,
      status: "refunded",
    };
  },
});

const sendNotificationTask = task({
  id: "business.sendNotification",
  run: async (notificationData: { email: string; type: string; orderId: string }) => {
    // Simulate sending notification
    console.log(`Sending ${notificationData.type} notification to ${notificationData.email} for order ${notificationData.orderId}`);
    return {
      notificationId: `notif_${Math.random().toString(36).substr(2, 9)}`,
      sent: true,
    };
  },
});

/**
 * Order Processing Workflow using OOP pattern
 * 
 * This workflow demonstrates:
 * - State transitions with validation
 * - Step execution with rollback capabilities  
 * - Time-based triggers for timeouts
 * - Event emission for monitoring
 */
class OrderProcessingWorkflow extends Workflow {
  constructor() {
    super({
      id: "order.processing.v2",
      name: "Order Processing Workflow v2",
      description: "Complete order processing with validation, payment, and notifications",
      initialState: "pending",
      states: [
        "pending",
        "validated", 
        "payment_processing",
        "paid",
        "completed",
        "failed",
        "cancelled"
      ],
      steps: [],
      transitions: [
        { 
          from: "pending", 
          to: "validated", 
          steps: ["validate_order"],
          rollbackable: true 
        },
        { 
          from: "validated", 
          to: "payment_processing", 
          steps: ["process_payment"],
          rollbackable: true,
          condition: async (context) => context.total > 0 
        },
        { 
          from: "payment_processing", 
          to: "paid",
          rollbackable: true 
        },
        { 
          from: "paid", 
          to: "completed", 
          steps: ["send_completion_notification"] 
        },
      ],
      timers: [
        {
          id: "payment_timeout",
          duration: 5 * 60 * 1000, // 5 minutes
          targetState: "failed",
          task: sendNotificationTask,
        },
        {
          id: "completion_reminder", 
          duration: 24 * 60 * 60 * 1000, // 24 hours
          targetState: "completed",
          recurring: false,
        },
      ],
      finalStates: ["completed", "failed", "cancelled"],
    });

    // Add steps using helper methods
    this.steps.push(
      this.createStep({
        id: "validate_order",
        name: "Validate Order",
        description: "Validate order data and calculate total",
        task: validateOrderTask,
        config: {
          timeout: 10000,
          retries: 2,
          rollbackable: true,
        },
      }),
      
      this.createStep({
        id: "process_payment",
        name: "Process Payment", 
        description: "Process customer payment",
        task: processPaymentTask,
        rollbackTask: refundPaymentTask,
        config: {
          timeout: 30000,
          retries: 3,
          rollbackable: true,
        },
      }),
      
      this.createStep({
        id: "send_completion_notification",
        name: "Send Completion Notification",
        description: "Send order completion notification to customer",
        task: sendNotificationTask,
        config: {
          timeout: 5000,
          retries: 1,
          rollbackable: false,
        },
      })
    );
  }
}

/**
 * Simple notification workflow example
 */
class NotificationWorkflow extends Workflow {
  constructor() {
    super({
      id: "notification.simple",
      initialState: "pending",
      states: ["pending", "sent", "failed"],
      steps: [
        {
          id: "send_notification", 
          task: sendNotificationTask,
          config: { timeout: 5000, retries: 2 },
        },
      ],
      transitions: [
        { from: "pending", to: "sent", steps: ["send_notification"] },
      ],
      finalStates: ["sent", "failed"],
    });
  }
}

/**
 * Example application using workflow OOP pattern
 */
export async function runOrderProcessingExample() {
  const app = resource({
    id: "order.processing.app",
    register: [
      workflowResource,
      validateOrderTask,
      processPaymentTask, 
      refundPaymentTask,
      sendNotificationTask,
    ],
    dependencies: {
      workflows: workflowResource,
    },
    init: async (_, { workflows }) => {
      // Create and register workflow instances
      const orderWorkflow = new OrderProcessingWorkflow();
      const notificationWorkflow = new NotificationWorkflow();
      
      await workflows.registerWorkflow(orderWorkflow);
      await workflows.registerWorkflow(notificationWorkflow);
      
      // Create order workflow instance
      const orderInstance = await workflows.createInstance(
        "order.processing.v2",
        {
          orderId: "order_12345",
          customerEmail: "customer@example.com",
          items: [
            { id: "item1", quantity: 2, price: 29.99 },
            { id: "item2", quantity: 1, price: 49.99 },
          ],
        }
      );
      
      console.log("Created order workflow instance:", orderInstance.id);
      console.log("Initial state:", orderInstance.currentState);
      
      // Execute workflow steps
      console.log("Transitioning to validated...");
      await workflows.transitionTo(orderInstance.id, "validated");
      
      console.log("Transitioning to payment processing...");
      await workflows.transitionTo(orderInstance.id, "payment_processing");
      
      console.log("Transitioning to paid...");
      await workflows.transitionTo(orderInstance.id, "paid");
      
      console.log("Transitioning to completed...");
      await workflows.transitionTo(orderInstance.id, "completed");
      
      // Check final state
      const finalInstance = await workflows.getInstance(orderInstance.id);
      console.log("Final state:", finalInstance?.currentState);
      console.log("Status:", finalInstance?.status);
      
      // Get execution history
      const history = await workflows.getExecutionHistory(orderInstance.id);
      console.log("Execution history entries:", history.length);
      
      return {
        orderInstanceId: orderInstance.id,
        finalState: finalInstance?.currentState,
        executionSteps: history.length,
      };
    },
  });
  
  const { value, dispose } = await run(app);
  console.log("Application result:", value);
  
  // Cleanup
  await dispose();
  
  return value;
}

// Uncomment to run the example
// runOrderProcessingExample().catch(console.error);