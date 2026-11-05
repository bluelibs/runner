import { getDurableWorkflowConcurrency } from "../../tags/durableWorkflow.tag";
import type { AnyTask } from "../../../../types/task";
import type { IDurableStore } from "../interfaces/store";
import type { ExecutionLockState } from "./ExecutionManager.locking";
import { StoreAdmissionController } from "./StoreAdmissionController";
import type { StoreAdmission } from "./StoreAdmissionController";

export type WorkflowAdmission = StoreAdmission;

/** Coordinates workflow-level admission through distributed store locks. */
export class WorkflowAdmissionController {
  private readonly admission: StoreAdmissionController;

  constructor(store: IDurableStore) {
    this.admission = new StoreAdmissionController(store, "workflow");
  }

  async tryAdmit(params: {
    task: AnyTask;
    workflowKey: string;
    executionLockState: ExecutionLockState;
  }): Promise<WorkflowAdmission> {
    return await this.admission.tryAdmit({
      ...params,
      policy: getDurableWorkflowConcurrency(params.task),
      key: params.workflowKey,
    });
  }

  async defer(executionId: string, retryAfterMs: number): Promise<void> {
    await this.admission.defer(executionId, retryAfterMs);
  }
}
