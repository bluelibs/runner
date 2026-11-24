import type { IResource } from "../../defs";
import {
  lazyResourceShutdownAccessError,
  resourceCooldownAdmissionTargetInvalidError,
} from "../../errors";
import type { ResourceCooldownAdmissionTargets } from "../../types/resource";
import type {
  IRuntimeInspectionLifecycle,
  IRuntimeInspectionLifecycleWave,
} from "../../types/runtimeInspection";
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
import { LifecycleAdmissionController } from "../runtime/LifecycleAdmissionController";
import {
  executeLifecycleWave,
  logCooldownErrors,
  runReadyWave,
} from "./storeLifecycleWaves";

type StoreLifecycleState = {
  readonly eventManager: EventManager;
  readonly admission: LifecycleAdmissionController;
  readonly logger: Logger;
  readonly resources: Map<string, ResourceStoreElementType>;
  findIdByDefinition: (definition: unknown) => string;
  resolveDefinitionId: (reference: unknown) => string | undefined;
};

/**
 * Owns resource initialization waves and `ready`/`cooldown`/`dispose` lifecycle choreography.
 */
export class StoreLifecycleCoordinator {
  private readonly initWaves: InitWave[] = [];
  private readonly initializedResourceIds = new Set<string>();
  private readonly readyResourceIds = new Set<string>();
  private hasRunCooldown = false;

  constructor(private readonly state: StoreLifecycleState) {}

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
    if (this.initializedResourceIds.has(resourceId)) {
      return;
    }

    this.initializedResourceIds.add(resourceId);
    this.initWaves.push({
      resourceIds: [resourceId],
      parallel: false,
    });
  }

  public recordInitWave(resourceIds: readonly string[]): void {
    const uniqueResourceIds = Array.from(
      new Set(resourceIds.filter((id) => !this.initializedResourceIds.has(id))),
    );
    if (uniqueResourceIds.length === 0) {
      return;
    }

    for (const resourceId of uniqueResourceIds) {
      this.initializedResourceIds.add(resourceId);
    }

    this.initWaves.push({
      resourceIds: uniqueResourceIds,
      parallel: uniqueResourceIds.length > 1,
    });
  }

  public getResourcesInDisposeWaves(): DisposeWave[] {
    return computeDisposeWaves(this.state.resources, this.initWaves);
  }

  public getResourcesInReadyWaves(): DisposeWave[] {
    return computeReadyWaves(this.state.resources, this.initWaves);
  }

  public getLifecycleInspection(): IRuntimeInspectionLifecycle {
    const toInspectionWaves = (
      waves: DisposeWave[],
    ): IRuntimeInspectionLifecycleWave[] =>
      waves.map((wave, order) => ({
        order,
        resourceIds: wave.resources.map(({ resource }) => resource.id),
        parallel: wave.parallel,
      }));

    return {
      readyWaves: toInspectionWaves(this.getResourcesInReadyWaves()),
      shutdownWaves: toInspectionWaves(this.getResourcesInDisposeWaves()),
    };
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
    if (this.hasRunCooldown) {
      return;
    }

    this.hasRunCooldown = true;

    for (const wave of this.getResourcesInDisposeWaves()) {
      if (options?.shouldStop?.()) {
        return;
      }

      const waveErrors = await this.cooldownWave(wave, options);
      await logCooldownErrors(this.state.logger, waveErrors);
    }
  }

  public clearRuntimeStateAfterDispose(): void {
    for (const resource of this.state.resources.values()) {
      resource.value = undefined;
      resource.context = undefined;
      resource.computedDependencies = undefined;
      resource.isInitialized = false;
    }

    this.initWaves.length = 0;
    this.initializedResourceIds.clear();
    this.readyResourceIds.clear();
    this.hasRunCooldown = false;
    this.state.admission.markDisposed();
  }

  public cooldownWave(
    wave: DisposeWave,
    options?: { shouldStop?: () => boolean },
  ): Promise<Error[]> {
    return executeLifecycleWave(wave, async (resource) => {
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
    await runReadyWave(
      wave,
      (resource) => this.runReadyResource(resource),
      options,
    );
  }

  public disposeWave(wave: DisposeWave): Promise<Error[]> {
    return executeLifecycleWave(wave, (resource) =>
      this.disposeResource(resource),
    );
  }

  public async runReadyResource(
    resource: ResourceStoreElementType,
  ): Promise<void> {
    if (!resource.isInitialized || !resource.resource.ready) {
      return;
    }

    const resourceId = resource.resource.id;
    if (this.readyResourceIds.has(resourceId)) {
      return;
    }

    await resource.resource.ready(
      resource.value,
      resource.config,
      resource.computedDependencies ?? {},
      resource.context,
    );
    this.readyResourceIds.add(resourceId);
  }

  public assertLazyResourceWakeupAllowed(resourceId: string): void {
    if (!this.state.admission.isDisposalStarted()) {
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
    this.state.admission.allowShutdownResourceSource(resourceRuntimePath);

    if (!targets || targets.length === 0) {
      return;
    }

    for (const target of targets) {
      const resolvedRuntimePath = this.resolveCooldownAdmissionTargetPath(
        resource,
        target,
      );
      this.state.admission.allowShutdownResourceSource(resolvedRuntimePath);
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
