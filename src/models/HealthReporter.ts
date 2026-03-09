import {
  IResource,
  IResourceHealthReport,
  IResourceHealthReportEntry,
} from "../defs";
import {
  healthReportEntryNotFoundError,
  runtimeElementNotFoundError,
} from "../errors";
import type { Store } from "./Store";
import type { IHealthReporter } from "../types/runner";

type HealthReporterOptions = {
  ensureAvailable: () => void;
  assertResourceAccess?: (resourceId: string) => void;
  isResourceAccessible?: (resourceId: string) => boolean;
  isSleepingResource?: (resourceId: string) => boolean;
};

export class HealthReporter implements IHealthReporter {
  constructor(
    private readonly store: Store,
    private readonly options: HealthReporterOptions,
  ) {}

  public getHealth = async (
    resourceDefs?: Array<string | IResource<any, any, any, any, any>>,
  ): Promise<IResourceHealthReport> => {
    this.options.ensureAvailable();

    const resourceIds = this.resolveHealthResourceIds(resourceDefs);
    const report = await Promise.all(
      resourceIds.map((resourceId) => this.evaluateResourceHealth(resourceId)),
    );

    const totals = {
      resources: report.length,
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
    };

    for (const entry of report) {
      if (entry.status === "healthy") {
        totals.healthy += 1;
        continue;
      }

      if (entry.status === "degraded") {
        totals.degraded += 1;
        continue;
      }

      totals.unhealthy += 1;
    }

    return this.createHealthReport(totals, report);
  };

  private createHealthReport(
    totals: IResourceHealthReport["totals"],
    report: IResourceHealthReportEntry[],
  ): IResourceHealthReport {
    return {
      totals,
      report,
      find: (resource) => {
        const resourceId = this.resolveResourceId(resource);
        const entry = report.find((candidate) => candidate.id === resourceId);
        if (entry) {
          return entry;
        }

        throw healthReportEntryNotFoundError.create({ resourceId });
      },
    };
  }

  private resolveHealthResourceIds(
    resourceDefs?: Array<string | IResource<any, any, any, any, any>>,
  ): string[] {
    if (!resourceDefs || resourceDefs.length === 0) {
      return Array.from(this.store.resources.values())
        .filter((entry) => entry.resource.health)
        .filter(
          (entry) =>
            this.options.isResourceAccessible?.(entry.resource.id) !== false &&
            this.options.isSleepingResource?.(entry.resource.id) !== true,
        )
        .map((entry) => entry.resource.id);
    }

    const seen = new Set<string>();
    const resourceIds: string[] = [];

    for (const resourceDef of resourceDefs) {
      const resourceId = this.resolveResourceId(resourceDef);
      if (!this.store.resources.has(resourceId)) {
        runtimeElementNotFoundError.throw({
          type: "Resource",
          elementId: resourceId,
        });
      }

      this.options.assertResourceAccess?.(resourceId);
      if (seen.has(resourceId)) {
        continue;
      }
      seen.add(resourceId);

      const entry = this.store.resources.get(resourceId)!;
      if (
        entry.resource.health &&
        this.options.isSleepingResource?.(resourceId) !== true
      ) {
        resourceIds.push(resourceId);
      }
    }

    return resourceIds;
  }

  private async evaluateResourceHealth(
    resourceId: string,
  ): Promise<IResourceHealthReportEntry> {
    const entry = this.store.resources.get(resourceId)!;
    const metadata = this.store.getRuntimeMetadata(entry.resource);
    const baseEntry = {
      id: metadata.path,
      initialized: entry.isInitialized === true,
    };

    try {
      const result = await entry.resource.health!(
        entry.value,
        entry.config,
        entry.computedDependencies ?? {},
        entry.context,
      );

      return {
        ...baseEntry,
        ...result,
      };
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));

      return {
        ...baseEntry,
        status: "unhealthy",
        message: normalizedError.message,
        details: normalizedError,
      };
    }
  }

  private resolveResourceId(
    resource: string | IResource<any, any, any, any, any>,
  ): string {
    const resolved = this.store.resolveDefinitionId(resource);
    if (resolved) {
      return resolved;
    }

    return typeof resource === "string" ? resource : resource.id;
  }
}
