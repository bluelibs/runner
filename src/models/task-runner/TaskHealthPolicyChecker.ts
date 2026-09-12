import type { ITask } from "../../defs";
import {
  taskBlockedByResourceHealthError,
  taskHealthResourceNotReportableError,
} from "../../errors";
import { globalTags } from "../../globals/globalTags";
import type { Store } from "../store/Store";

type TaskHealthPolicy = {
  readonly resourceIds: readonly string[];
  readonly nonReportableResourceIds: readonly string[];
};

/** Caches immutable health policy by canonical task id within one runtime. */
export class TaskHealthPolicyChecker {
  private readonly healthPolicyStore = new Map<
    string,
    TaskHealthPolicy | null
  >();

  /** Binds health checks to the owning runtime's registry and live resources. */
  public constructor(private readonly store: Store) {}

  /**
   * Enforces the task-level fail-when-unhealthy policy once runtime execution
   * has started.
   *
   * @param task The task about to execute.
   * @returns A promise when an asynchronous health check is required.
   */
  public assertHealthy(
    task: ITask<any, any, any>,
    taskId: string,
  ): Promise<void> | void {
    if (!this.store.isLocked) {
      return;
    }

    const healthPolicy = this.getTaskHealthPolicy(task, taskId);
    if (!healthPolicy) {
      return;
    }

    return this.assertMonitoredResourcesHealthy(taskId, healthPolicy);
  }

  private getTaskHealthPolicy(
    task: ITask<any, any, any>,
    taskId: string,
  ): TaskHealthPolicy | null {
    if (this.healthPolicyStore.has(taskId)) {
      return this.healthPolicyStore.get(taskId)!;
    }

    const monitoredResources = globalTags.failWhenUnhealthy.extract(task);
    if (!monitoredResources || monitoredResources.length === 0) {
      this.healthPolicyStore.set(taskId, null);
      return null;
    }

    const resourceIds = monitoredResources.map((resource) =>
      this.store.findIdByDefinition(resource),
    );
    const nonReportableResourceIds = resourceIds.filter((resourceId) => {
      const resourceEntry = this.store.resources.get(resourceId);
      return !resourceEntry?.resource.health;
    });
    const policy: TaskHealthPolicy = Object.freeze({
      resourceIds: Object.freeze(resourceIds),
      nonReportableResourceIds: Object.freeze(nonReportableResourceIds),
    });
    this.healthPolicyStore.set(taskId, policy);
    return policy;
  }

  /**
   * Ensures that all resources monitored by the task's health policy are both
   * reportable and currently healthy.
   *
   * @param taskId The task whose monitored resources are being validated.
   * @param healthPolicy The pre-resolved task health policy.
   */
  private async assertMonitoredResourcesHealthy(
    taskId: string,
    healthPolicy: TaskHealthPolicy,
  ): Promise<void> {
    if (healthPolicy.nonReportableResourceIds.length > 0) {
      taskHealthResourceNotReportableError.throw({
        taskId,
        resourceIds: [...healthPolicy.nonReportableResourceIds],
      });
    }

    const report = await this.store
      .getHealthReporter()
      .getHealth(healthPolicy.resourceIds, {
        isSleepingResource: (resourceId) =>
          this.store.resources.get(resourceId)!.isInitialized !== true,
      });
    const unhealthyResourceIds = report.report
      .filter((entry) => entry.status === "unhealthy")
      .map((entry) => entry.id);

    if (unhealthyResourceIds.length > 0) {
      taskBlockedByResourceHealthError.throw({
        taskId,
        resourceIds: unhealthyResourceIds,
      });
    }
  }
}
