import type { IResource } from "../../defs";
import {
  lazyResourceShutdownAccessError,
  resourceCooldownAdmissionTargetInvalidError,
} from "../../errors";
import type { ResourceCooldownAdmissionTargets } from "../../types/resource";
import type { RuntimeCallSource } from "../../types/runtimeSource";
import type {
  DisposeWave,
  InitWave,
  ResourceStoreElementType,
} from "../../types/storeTypes";
import { EventManager } from "../EventManager";
import { Logger } from "../Logger";
import {
  getResourcesInDisposeWaves as computeDisposeWaves,
  getResourcesInReadyWaves as computeReadyWaves,
} from "../utils/disposeOrder";
import {
  LifecycleAdmissionController,
  RuntimeLifecyclePhase,
} from "../runtime/LifecycleAdmissionController";

type StoreLifecycleState = {
  readonly eventManager: EventManager;
  readonly initWaves: InitWave[];
  readonly initializedResourceIds: Set<string>;
  readonly lifecycleAdmissionController: LifecycleAdmissionController;
  readonly logger: Logger;
  readonly readyResourceIds: Set<string>;
  readonly resources: Map<string, ResourceStoreElementType>;
  getHasRunCooldown: () => boolean;
  setHasRunCooldown: (value: boolean) => void;
  findIdByDefinition: (definition: unknown) => string;
  resolveDefinitionId: (reference: unknown) => string | undefined;
};

export class StoreLifecycleCoordinator {
  constructor(private readonly state: StoreLifecycleState) {}

  public isInShutdownLockdown(): boolean {
    return this.state.lifecycleAdmissionController.isShutdownLockdown();
  }

  public isDisposalStarted(): boolean {
    const phase = this.state.lifecycleAdmissionController.getPhase();
    return (
      phase === RuntimeLifecyclePhase.CoolingDown ||
      phase === RuntimeLifecyclePhase.Disposing ||
      phase === RuntimeLifecyclePhase.Aborting ||
      phase === RuntimeLifecyclePhase.Drained ||
      phase === RuntimeLifecyclePhase.Disposed
    );
  }

  public canAdmitTaskCall(source: RuntimeCallSource): boolean {
    return this.state.lifecycleAdmissionController.canAdmitTask(source);
  }

  public beginDisposing(): void {
    const phase = this.state.lifecycleAdmissionController.getPhase();
    if (
      phase === RuntimeLifecyclePhase.Disposing ||
      phase === RuntimeLifecyclePhase.Aborting ||
      phase === RuntimeLifecyclePhase.Drained ||
      phase === RuntimeLifecyclePhase.Disposed
    ) {
      return;
    }

    this.state.lifecycleAdmissionController.beginDisposing();
  }

  public beginCoolingDown(): void {
    const phase = this.state.lifecycleAdmissionController.getPhase();
    if (
      phase === RuntimeLifecyclePhase.CoolingDown ||
      phase === RuntimeLifecyclePhase.Disposing ||
      phase === RuntimeLifecyclePhase.Aborting ||
      phase === RuntimeLifecyclePhase.Drained ||
      phase === RuntimeLifecyclePhase.Disposed
    ) {
      return;
    }

    this.state.lifecycleAdmissionController.beginCoolingDown();
  }

  public beginAborting(): void {
    const phase = this.state.lifecycleAdmissionController.getPhase();
    if (
      phase === RuntimeLifecyclePhase.Aborting ||
      phase === RuntimeLifecyclePhase.Drained ||
      phase === RuntimeLifecyclePhase.Disposed
    ) {
      return;
    }

    this.state.lifecycleAdmissionController.beginAborting();
  }

  public beginDrained(): void {
    this.state.lifecycleAdmissionController.beginDrained();
  }

  public waitForDrain(drainingBudgetMs: number): Promise<boolean> {
    return this.state.lifecycleAdmissionController.waitForDrain(
      drainingBudgetMs,
    );
  }

  public trackTaskAbortController(controller: AbortController): () => void {
    return this.state.lifecycleAdmissionController.trackTaskAbortController(
      controller,
    );
  }

  public abortInFlightTaskSignals(reason: string): void {
    this.state.lifecycleAdmissionController.abortInFlightTaskSignals(reason);
  }

  public cancelDrainWaiters(): void {
    this.state.lifecycleAdmissionController.cancelDrainWaiters();
  }

  public markDisposed(): void {
    this.state.lifecycleAdmissionController.markDisposed();
  }

  public enterShutdownLockdown(): void {
    this.beginDisposing();
  }

  public async dispose(): Promise<void> {
    const disposalErrors: Error[] = [];

    for (const wave of this.getResourcesInDisposeWaves()) {
      const waveErrors = await this.disposeWave(wave);
      disposalErrors.push(...waveErrors);
    }

    this.clearRuntimeStateAfterDispose();
    this.state.eventManager.dispose();

    if (disposalErrors.length === 1) {
      throw disposalErrors[0];
    }

    if (disposalErrors.length > 1) {
      throw Object.assign(
        new Error("One or more resources failed to dispose."),
        {
          name: "AggregateError",
          errors: disposalErrors,
          cause: disposalErrors[0],
        },
      );
    }
  }

  public recordResourceInitialized(resourceId: string): void {
    if (this.state.initializedResourceIds.has(resourceId)) {
      return;
    }

    this.state.initializedResourceIds.add(resourceId);
    this.state.initWaves.push({
      resourceIds: [resourceId],
      parallel: false,
    });
  }

  public recordInitWave(resourceIds: readonly string[]): void {
    const uniqueResourceIds = Array.from(
      new Set(
        resourceIds.filter((id) => !this.state.initializedResourceIds.has(id)),
      ),
    );
    if (uniqueResourceIds.length === 0) {
      return;
    }

    for (const resourceId of uniqueResourceIds) {
      this.state.initializedResourceIds.add(resourceId);
    }

    this.state.initWaves.push({
      resourceIds: uniqueResourceIds,
      parallel: uniqueResourceIds.length > 1,
    });
  }

  public getResourcesInDisposeWaves(): DisposeWave[] {
    return computeDisposeWaves(this.state.resources, this.state.initWaves);
  }

  public getResourcesInReadyWaves(): DisposeWave[] {
    return computeReadyWaves(this.state.resources, this.state.initWaves);
  }

  public async ready(options?: { shouldStop?: () => void }): Promise<void> {
    for (const wave of this.getResourcesInReadyWaves()) {
      options?.shouldStop?.();
      await this.readyWave(wave, options);
    }
  }

  public async readyResource(resourceId: string): Promise<void> {
    const resource = this.state.resources.get(resourceId);
    if (!resource) {
      return;
    }

    this.assertLazyResourceWakeupAllowed(resourceId);
    await this.runReadyResource(resource);
  }

  public async cooldown(options?: {
    shouldStop?: () => boolean;
  }): Promise<void> {
    if (this.state.getHasRunCooldown()) {
      return;
    }

    this.state.setHasRunCooldown(true);

    for (const wave of this.getResourcesInDisposeWaves()) {
      if (options?.shouldStop?.()) {
        return;
      }

      const waveErrors = await this.cooldownWave(wave, options);
      await this.logCooldownErrors(waveErrors);
    }
  }

  public clearRuntimeStateAfterDispose(): void {
    for (const resource of this.state.resources.values()) {
      resource.value = undefined;
      resource.context = undefined;
      resource.computedDependencies = undefined;
      resource.isInitialized = false;
    }

    this.state.initWaves.length = 0;
    this.state.initializedResourceIds.clear();
    this.state.readyResourceIds.clear();
    this.state.setHasRunCooldown(false);
    this.markDisposed();
  }

  public async executeWave(
    wave: DisposeWave,
    action: (resource: ResourceStoreElementType) => Promise<void>,
  ): Promise<Error[]> {
    const normalizeError = (error: unknown): Error =>
      error instanceof Error ? error : new Error(String(error));
    const collectWaveErrors = (
      results: readonly PromiseSettledResult<void>[],
    ): Error[] =>
      results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => normalizeError(result.reason));

    if (wave.parallel) {
      const results = await Promise.allSettled(
        wave.resources.map((resource) => action(resource)),
      );
      return collectWaveErrors(results);
    }

    const errors: Error[] = [];
    for (const resource of wave.resources) {
      try {
        await action(resource);
      } catch (error) {
        errors.push(normalizeError(error));
      }
    }

    return errors;
  }

  public cooldownWave(
    wave: DisposeWave,
    options?: { shouldStop?: () => boolean },
  ): Promise<Error[]> {
    return this.executeWave(wave, async (resource) => {
      if (options?.shouldStop?.()) {
        return;
      }

      await this.cooldownResource(resource);
    });
  }

  public async readyWave(
    wave: DisposeWave,
    options?: { shouldStop?: () => void },
  ): Promise<void> {
    if (wave.parallel) {
      const runningReadyPromises: Promise<void>[] = [];
      try {
        for (const resource of wave.resources) {
          options?.shouldStop?.();
          runningReadyPromises.push(this.runReadyResource(resource));
        }
      } catch (error) {
        if (runningReadyPromises.length > 0) {
          await Promise.allSettled(runningReadyPromises);
        }
        throw this.normalizeError(error);
      }

      const settledResults = await Promise.allSettled(runningReadyPromises);
      const rejectedResult = settledResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (rejectedResult) {
        throw this.normalizeError(rejectedResult.reason);
      }

      return;
    }

    for (const resource of wave.resources) {
      try {
        options?.shouldStop?.();
        await this.runReadyResource(resource);
      } catch (error) {
        throw this.normalizeError(error);
      }
    }
  }

  public disposeWave(wave: DisposeWave): Promise<Error[]> {
    return this.executeWave(wave, (resource) => this.disposeResource(resource));
  }

  public normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  public async logCooldownErrors(errors: readonly Error[]): Promise<void> {
    for (const error of errors) {
      try {
        await this.state.logger.warn(
          "Resource cooldown failed; continuing shutdown.",
          {
            source: "store.cooldown",
            error,
          },
        );
      } catch {
        // Logging must never promote cooldown failures into shutdown failures.
      }
    }
  }

  public async runReadyResource(
    resource: ResourceStoreElementType,
  ): Promise<void> {
    if (!resource.isInitialized || !resource.resource.ready) {
      return;
    }

    const resourceId = resource.resource.id;
    if (this.state.readyResourceIds.has(resourceId)) {
      return;
    }

    await resource.resource.ready(
      resource.value,
      resource.config,
      resource.computedDependencies ?? {},
      resource.context,
    );
    this.state.readyResourceIds.add(resourceId);
  }

  public assertLazyResourceWakeupAllowed(resourceId: string): void {
    if (!this.isDisposalStarted()) {
      return;
    }

    lazyResourceShutdownAccessError.throw({
      id: this.state.findIdByDefinition(resourceId),
    });
  }

  public async disposeResource(
    resource: ResourceStoreElementType,
  ): Promise<void> {
    if (!resource.isInitialized || !resource.resource.dispose) {
      return;
    }

    await resource.resource.dispose(
      resource.value,
      resource.config,
      resource.computedDependencies ?? {},
      resource.context,
    );
  }

  public async cooldownResource(
    resource: ResourceStoreElementType,
  ): Promise<void> {
    if (!resource.isInitialized || !resource.resource.cooldown) {
      return;
    }

    const admissionTargets = await resource.resource.cooldown(
      resource.value,
      resource.config,
      resource.computedDependencies ?? {},
      resource.context,
    );

    this.registerCooldownAdmissionTargets(
      this.state.findIdByDefinition(resource.resource),
      resource.resource,
      admissionTargets,
    );
  }

  public registerCooldownAdmissionTargets(
    resourceRuntimePath: string,
    resource: IResource<any, any, any, any, any>,
    targets: void | ResourceCooldownAdmissionTargets,
  ): void {
    this.state.lifecycleAdmissionController.allowShutdownResourceSource(
      resourceRuntimePath,
    );

    if (!targets || targets.length === 0) {
      return;
    }

    for (const target of targets) {
      const resolvedRuntimePath = this.resolveCooldownAdmissionTargetPath(
        resource,
        target,
      );
      this.state.lifecycleAdmissionController.allowShutdownResourceSource(
        resolvedRuntimePath,
      );
    }
  }

  public resolveCooldownAdmissionTargetPath(
    resource: IResource<any, any, any, any, any>,
    target: ResourceCooldownAdmissionTargets[number],
  ): string {
    const resolvedRuntimePath = this.state.resolveDefinitionId(target);
    if (
      typeof resolvedRuntimePath !== "string" ||
      !this.state.resources.has(resolvedRuntimePath)
    ) {
      throw resourceCooldownAdmissionTargetInvalidError.new({
        resourceId: this.state.findIdByDefinition(resource),
        targetId: String(target?.id ?? target),
      });
    }

    return resolvedRuntimePath;
  }
}
