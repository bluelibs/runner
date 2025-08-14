/**
 * In-memory workflow adapter for testing and development.
 * 
 * This adapter stores all workflow data in memory and is suitable for:
 * - Testing workflow logic without external dependencies
 * - Development and prototyping
 * - Single-process applications with temporary workflow needs
 * 
 * Note: All data is lost when the process terminates.
 */

import {
  IWorkflowAdapter,
  IWorkflowInstance,
  WorkflowInstanceId,
  WorkflowStatus,
  WorkflowState,
  IWorkflowExecution,
} from "../defs";

/**
 * Memory-based workflow adapter implementation
 */
export class MemoryWorkflowAdapter implements IWorkflowAdapter {
  private instances = new Map<WorkflowInstanceId, IWorkflowInstance>();
  private executions = new Map<WorkflowInstanceId, IWorkflowExecution[]>();

  /**
   * Save a workflow instance to memory
   */
  async saveInstance(instance: IWorkflowInstance): Promise<void> {
    // Deep clone to prevent mutations
    const cloned = this.deepClone(instance);
    cloned.updatedAt = new Date();
    this.instances.set(instance.id, cloned);
  }

  /**
   * Load a workflow instance by ID
   */
  async loadInstance(instanceId: WorkflowInstanceId): Promise<IWorkflowInstance | null> {
    const instance = this.instances.get(instanceId);
    return instance ? this.deepClone(instance) : null;
  }

  /**
   * Update an existing workflow instance
   */
  async updateInstance(instance: IWorkflowInstance): Promise<void> {
    if (!this.instances.has(instance.id)) {
      throw new Error(`Workflow instance with ID ${instance.id} does not exist`);
    }
    
    const cloned = this.deepClone(instance);
    cloned.updatedAt = new Date();
    this.instances.set(instance.id, cloned);
  }

  /**
   * Delete a workflow instance
   */
  async deleteInstance(instanceId: WorkflowInstanceId): Promise<void> {
    this.instances.delete(instanceId);
    this.executions.delete(instanceId);
  }

  /**
   * Find workflow instances by criteria
   */
  async findInstances(criteria: {
    workflowId?: string;
    status?: WorkflowStatus;
    state?: WorkflowState;
    createdBefore?: Date;
    createdAfter?: Date;
  }): Promise<IWorkflowInstance[]> {
    const results: IWorkflowInstance[] = [];

    for (const instance of this.instances.values()) {
      if (this.matchesCriteria(instance, criteria)) {
        results.push(this.deepClone(instance));
      }
    }

    return results;
  }

  /**
   * Save workflow execution record
   */
  async saveExecution(instanceId: WorkflowInstanceId, execution: IWorkflowExecution): Promise<void> {
    if (!this.executions.has(instanceId)) {
      this.executions.set(instanceId, []);
    }
    
    const executions = this.executions.get(instanceId)!;
    executions.push(this.deepClone(execution));
  }

  /**
   * Load execution history for an instance
   */
  async loadExecutions(instanceId: WorkflowInstanceId): Promise<IWorkflowExecution[]> {
    const executions = this.executions.get(instanceId) || [];
    return executions.map(execution => this.deepClone(execution));
  }

  /**
   * Clean up expired or completed instances
   */
  async cleanup(olderThan: Date): Promise<number> {
    let cleanedCount = 0;

    for (const [instanceId, instance] of this.instances.entries()) {
      const shouldCleanup = 
        instance.createdAt < olderThan &&
        (instance.status === WorkflowStatus.COMPLETED ||
         instance.status === WorkflowStatus.FAILED ||
         instance.status === WorkflowStatus.CANCELLED);

      if (shouldCleanup) {
        this.instances.delete(instanceId);
        this.executions.delete(instanceId);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Get all instances (useful for testing)
   */
  getAllInstances(): IWorkflowInstance[] {
    return Array.from(this.instances.values()).map(instance => this.deepClone(instance));
  }

  /**
   * Get all executions (useful for testing)
   */
  getAllExecutions(): Map<WorkflowInstanceId, IWorkflowExecution[]> {
    const result = new Map<WorkflowInstanceId, IWorkflowExecution[]>();
    for (const [instanceId, executions] of this.executions.entries()) {
      result.set(instanceId, executions.map(execution => this.deepClone(execution)));
    }
    return result;
  }

  /**
   * Clear all data (useful for testing)
   */
  clear(): void {
    this.instances.clear();
    this.executions.clear();
  }

  /**
   * Get current statistics (useful for monitoring)
   */
  getStats(): {
    totalInstances: number;
    instancesByStatus: Record<WorkflowStatus, number>;
    totalExecutions: number;
  } {
    const instancesByStatus = {
      [WorkflowStatus.PENDING]: 0,
      [WorkflowStatus.RUNNING]: 0,
      [WorkflowStatus.COMPLETED]: 0,
      [WorkflowStatus.FAILED]: 0,
      [WorkflowStatus.CANCELLED]: 0,
      [WorkflowStatus.ROLLBACK]: 0,
    };

    for (const instance of this.instances.values()) {
      instancesByStatus[instance.status]++;
    }

    let totalExecutions = 0;
    for (const executions of this.executions.values()) {
      totalExecutions += executions.length;
    }

    return {
      totalInstances: this.instances.size,
      instancesByStatus,
      totalExecutions,
    };
  }

  /**
   * Deep clone an object to prevent mutations
   */
  private deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }
    
    if (obj instanceof Date) {
      return new Date(obj.getTime()) as T;
    }
    
    if (obj instanceof Array) {
      return obj.map(item => this.deepClone(item)) as T;
    }
    
    if (typeof obj === "object") {
      const cloned = {} as T;
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          cloned[key] = this.deepClone(obj[key]);
        }
      }
      return cloned;
    }
    
    return obj;
  }

  /**
   * Check if an instance matches the given criteria
   */
  private matchesCriteria(
    instance: IWorkflowInstance,
    criteria: {
      workflowId?: string;
      status?: WorkflowStatus;
      state?: WorkflowState;
      createdBefore?: Date;
      createdAfter?: Date;
    }
  ): boolean {
    if (criteria.workflowId && instance.workflowId !== criteria.workflowId) {
      return false;
    }
    
    if (criteria.status && instance.status !== criteria.status) {
      return false;
    }
    
    if (criteria.state && instance.currentState !== criteria.state) {
      return false;
    }
    
    if (criteria.createdBefore && instance.createdAt >= criteria.createdBefore) {
      return false;
    }
    
    if (criteria.createdAfter && instance.createdAt <= criteria.createdAfter) {
      return false;
    }
    
    return true;
  }
}