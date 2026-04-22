import type { Store } from "../../../models/store/Store";
import { durableExecutionInvariantError } from "../../../errors";
import {
  resolveRequestedIdFromStore,
  toCanonicalDefinitionFromStore,
} from "../../../models/store/StoreLookup";
import { check, Match } from "../../../tools/check";
import type { ITask } from "../../../types/task";
import {
  durableWorkflowTag,
  getDurableWorkflowKey,
} from "../tags/durableWorkflow.tag";
import type { DurableOperator } from "./DurableOperator";
import type {
  DurableExecutionDateFilter,
  DurableExecutionFilters,
  DurableExecutionRecord,
  DurableExecutionTreeNode,
  IDurableExecutionRepository,
  DurableExecutionQueryOptions,
} from "./interfaces/resource";
import type { IDurableStore } from "./interfaces/store";
import type { Execution } from "./types";

type UntypedExecutionRecord = DurableExecutionRecord<unknown, unknown>;
type UntypedExecutionTreeNode = DurableExecutionTreeNode<unknown, unknown>;
type DateSortField = "createdAt" | "updatedAt" | "completedAt";
const EXECUTION_PAGE_SIZE = 500;

interface DurableExecutionRepositoryOptions<TInput, TResult> {
  task: ITask<TInput, Promise<TResult>, any, any, any, any>;
  store: IDurableStore;
  operator: DurableOperator;
  runnerStore: Store;
}

export class DurableExecutionRepository<
  TInput,
  TResult,
> implements IDurableExecutionRepository<TInput, TResult> {
  private readonly workflowKey: string;
  private readonly taskLabel: string;

  constructor(
    private readonly options: DurableExecutionRepositoryOptions<
      TInput,
      TResult
    >,
  ) {
    const canonicalTask = this.resolveCanonicalTask();
    const tagConfig = durableWorkflowTag.extract(canonicalTask.tags);
    if (!tagConfig) {
      durableExecutionInvariantError.throw({
        message:
          `Cannot create a durable repository for task "${canonicalTask.id}": ` +
          "the task is not tagged with tags.durableWorkflow.",
      });
    }

    this.workflowKey = getDurableWorkflowKey(canonicalTask, canonicalTask.id)!;
    this.taskLabel = canonicalTask.id;
  }

  async find(
    filters: DurableExecutionFilters<TInput> = {},
    options?: DurableExecutionQueryOptions,
  ): Promise<Array<DurableExecutionRecord<TInput, TResult>>> {
    const executions = await this.listMatchingRootExecutions(filters, options);
    return await this.hydrateRecords(executions);
  }

  async findTree(
    filters: DurableExecutionFilters<TInput> = {},
    options?: DurableExecutionQueryOptions,
  ): Promise<Array<DurableExecutionTreeNode<TInput, TResult>>> {
    this.assertValidFilters(filters);
    this.assertValidQueryOptions(options);

    const [roots, allExecutions] = await Promise.all([
      this.listMatchingRootExecutions(filters, options),
      this.listAllExecutions(),
    ]);
    const childrenByParent = this.buildChildrenByParent(allExecutions);

    return await Promise.all(
      roots.map(
        async (root) => await this.hydrateRootTreeNode(root, childrenByParent),
      ),
    );
  }

  async findOne(
    filters: DurableExecutionFilters<TInput> = {},
  ): Promise<DurableExecutionRecord<TInput, TResult> | null> {
    const [match] = await this.listMatchingRootExecutions(filters);
    if (!match) {
      return null;
    }

    const [record] = await this.hydrateRecords([match]);
    return record;
  }

  async findOneOrFail(
    filters: DurableExecutionFilters<TInput> = {},
  ): Promise<DurableExecutionRecord<TInput, TResult>> {
    const record = await this.findOne(filters);
    if (record) {
      return record;
    }

    return durableExecutionInvariantError.throw({
      message:
        `No durable execution matched task "${this.taskLabel}" and query ` +
        `${JSON.stringify(filters)}.`,
    });
  }

  private resolveCanonicalTask(): ITask<
    TInput,
    Promise<TResult>,
    any,
    any,
    any,
    any
  > {
    const requestedId = resolveRequestedIdFromStore(
      this.options.runnerStore,
      this.options.task,
    );

    if (!requestedId) {
      return durableExecutionInvariantError.throw({
        message:
          `Cannot create a durable repository for task "${this.options.task.id}": ` +
          "the task is not registered in the runtime store.",
      });
    }

    const storeTask = this.options.runnerStore.tasks.get(requestedId);
    if (!storeTask) {
      return durableExecutionInvariantError.throw({
        message:
          `Cannot create a durable repository for task "${requestedId}": ` +
          "the task is not registered in the runtime store.",
      });
    }

    return toCanonicalDefinitionFromStore(
      this.options.runnerStore,
      storeTask.task as ITask<TInput, Promise<TResult>, any, any, any, any>,
    );
  }

  private async listMatchingRootExecutions(
    filters: DurableExecutionFilters<TInput>,
    options?: DurableExecutionQueryOptions,
  ): Promise<Array<Execution<TInput, TResult>>> {
    this.assertValidFilters(filters);
    this.assertValidQueryOptions(options);

    if (filters.id !== undefined) {
      const execution = await this.getMatchingExecutionById(filters.id);
      if (!execution || !this.matchesFilters(execution, filters)) {
        return [];
      }

      return this.applyQueryOptions([execution], options);
    }

    let executions = (await this.listAllExecutions({
      workflowKey: this.workflowKey,
    })) as Array<Execution<TInput, TResult>>;

    executions = executions.filter((execution) =>
      this.matchesFilters(execution, filters),
    );

    return this.applyQueryOptions(executions, options);
  }

  private async getMatchingExecutionById(
    executionId: string,
  ): Promise<Execution<TInput, TResult> | null> {
    const execution = await this.options.store.getExecution(executionId);
    return execution && execution.workflowKey === this.workflowKey
      ? (execution as Execution<TInput, TResult>)
      : null;
  }

  private async listAllExecutions(options?: {
    workflowKey?: string;
  }): Promise<Array<Execution<unknown, unknown>>> {
    const executions: Array<Execution<unknown, unknown>> = [];
    let offset = 0;

    while (true) {
      const page = await this.options.operator.listExecutions({
        workflowKey: options?.workflowKey,
        limit: EXECUTION_PAGE_SIZE,
        offset,
      });
      executions.push(...page);

      if (page.length < EXECUTION_PAGE_SIZE) {
        return executions;
      }

      offset += page.length;
    }
  }

  private matchesFilters(
    execution: Execution,
    filters: DurableExecutionFilters<TInput>,
  ): boolean {
    if (
      filters.parentExecutionId !== undefined &&
      execution.parentExecutionId !== filters.parentExecutionId
    ) {
      return false;
    }
    if (filters.status !== undefined && execution.status !== filters.status) {
      return false;
    }
    if (
      filters.attempt !== undefined &&
      execution.attempt !== filters.attempt
    ) {
      return false;
    }
    if (
      filters.maxAttempts !== undefined &&
      execution.maxAttempts !== filters.maxAttempts
    ) {
      return false;
    }
    if (!this.matchesDateFilter(execution.createdAt, filters.createdAt)) {
      return false;
    }
    if (!this.matchesDateFilter(execution.updatedAt, filters.updatedAt)) {
      return false;
    }
    if (!this.matchesDateFilter(execution.completedAt, filters.completedAt)) {
      return false;
    }
    if (!this.matchesInputFilter(execution.input, filters.input)) {
      return false;
    }

    return true;
  }

  private applyQueryOptions(
    executions: Array<Execution<TInput, TResult>>,
    options: DurableExecutionQueryOptions | undefined,
  ): Array<Execution<TInput, TResult>> {
    if (!options) {
      return executions;
    }

    const sorted = this.sortExecutions(executions, options.sort);
    const skip = options.skip ?? 0;

    if (options.limit === undefined) {
      return sorted.slice(skip);
    }

    return sorted.slice(skip, skip + options.limit);
  }

  private sortExecutions(
    executions: Array<Execution<TInput, TResult>>,
    sort: DurableExecutionQueryOptions["sort"],
  ): Array<Execution<TInput, TResult>> {
    if (!sort) {
      return [...executions];
    }

    const sortField = this.getSortField(sort);
    if (!sortField) {
      return [...executions];
    }

    const direction = sort[sortField]!;
    const sorted = [...executions];
    sorted.sort((left, right) => {
      const leftValue = this.getSortableDateValue(left, sortField);
      const rightValue = this.getSortableDateValue(right, sortField);
      return (leftValue - rightValue) * direction;
    });

    return sorted;
  }

  private getSortField(
    sort: NonNullable<DurableExecutionQueryOptions["sort"]>,
  ): DateSortField | null {
    const definedFields = (
      Object.entries(sort) as Array<[DateSortField, 1 | -1 | undefined]>
    )
      .filter(
        (entry): entry is [DateSortField, 1 | -1] => entry[1] !== undefined,
      )
      .map(([field]) => field);

    if (definedFields.length === 0) {
      return null;
    }

    if (definedFields.length > 1) {
      return durableExecutionInvariantError.throw({
        message:
          `Durable repository sort for task "${this.taskLabel}" supports exactly one date field at a time. Received: ` +
          `${definedFields.join(", ")}.`,
      });
    }

    return definedFields[0];
  }

  private getSortableDateValue(
    execution: Execution,
    field: DateSortField,
  ): number {
    const value = execution[field];
    return this.isDateValue(value) ? value.getTime() : Number.NEGATIVE_INFINITY;
  }

  private assertValidQueryOptions(
    options: DurableExecutionQueryOptions | undefined,
  ): void {
    if (!options) {
      return;
    }

    if (options.skip !== undefined && options.skip < 0) {
      durableExecutionInvariantError.throw({
        message: `Durable repository skip must be >= 0. Received: ${options.skip}.`,
      });
    }

    if (options.limit !== undefined && options.limit <= 0) {
      durableExecutionInvariantError.throw({
        message: `Durable repository limit must be > 0. Received: ${options.limit}.`,
      });
    }

    if (options.sort) {
      this.getSortField(options.sort);
    }
  }

  private assertValidFilters(filters: DurableExecutionFilters<TInput>): void {
    this.assertValidDateFilterValue(filters.createdAt, "createdAt");
    this.assertValidDateFilterValue(filters.updatedAt, "updatedAt");
    this.assertValidDateFilterValue(filters.completedAt, "completedAt");
  }

  private assertValidDateFilterValue(
    filter: Date | DurableExecutionDateFilter | undefined,
    fieldName: DateSortField,
  ): void {
    if (filter === undefined || this.isDateValue(filter)) {
      return;
    }

    if (!this.isDateRangeFilter(filter)) {
      durableExecutionInvariantError.throw({
        message: `Durable repository received an invalid ${fieldName} filter: ${JSON.stringify(filter)}.`,
      });
    }

    this.assertValidDateFilter(filter);
  }

  private matchesDateFilter(
    actual: Date | undefined,
    filter: Date | DurableExecutionDateFilter | undefined,
  ): boolean {
    if (filter === undefined) {
      return true;
    }

    if (!actual) {
      return false;
    }

    const actualMs = actual.getTime();
    if (this.isDateValue(filter)) {
      return actualMs === filter.getTime();
    }

    if (filter.$gt && !(actualMs > filter.$gt.getTime())) {
      return false;
    }
    if (filter.$gte && !(actualMs >= filter.$gte.getTime())) {
      return false;
    }
    if (filter.$lt && !(actualMs < filter.$lt.getTime())) {
      return false;
    }
    if (filter.$lte && !(actualMs <= filter.$lte.getTime())) {
      return false;
    }

    return true;
  }

  private isDateRangeFilter(
    value: unknown,
  ): value is DurableExecutionDateFilter {
    return typeof value === "object" && value !== null;
  }

  private assertValidDateFilter(filter: DurableExecutionDateFilter): void {
    const entries = Object.entries(filter);
    if (entries.length === 0) {
      durableExecutionInvariantError.throw({
        message:
          "Durable repository date range filters must include at least one " +
          "of $gt, $gte, $lt, or $lte.",
      });
    }

    const allowedKeys = new Set(["$gt", "$gte", "$lt", "$lte"]);
    for (const [key, value] of entries) {
      if (!allowedKeys.has(key)) {
        durableExecutionInvariantError.throw({
          message: `Durable repository received unsupported date filter operator "${key}". Allowed operators are $gt, $gte, $lt, $lte.`,
        });
      }

      try {
        check(
          value,
          Match.Where((candidate: unknown): candidate is Date =>
            this.isDateValue(candidate),
          ),
        );
      } catch {
        durableExecutionInvariantError.throw({
          message:
            `Durable repository received an invalid ${key} value for ` +
            `${JSON.stringify(filter)}. Expected a valid Date instance.`,
        });
      }
    }
  }

  private matchesInputFilter(actual: unknown, filter: unknown): boolean {
    if (filter === undefined) {
      return true;
    }

    if (this.isDateValue(filter)) {
      return this.isDateValue(actual) && actual.getTime() === filter.getTime();
    }

    if (Array.isArray(filter)) {
      if (!Array.isArray(actual) || actual.length !== filter.length) {
        return false;
      }

      return filter.every((item, index) =>
        this.matchesInputFilter(actual[index], item),
      );
    }

    if (typeof filter === "object" && filter !== null) {
      if (typeof actual !== "object" || actual === null) {
        return false;
      }

      return Object.entries(filter).every(([key, value]) =>
        this.matchesInputFilter(
          (actual as Record<string, unknown>)[key],
          value,
        ),
      );
    }

    return Object.is(actual, filter);
  }

  private isDateValue(value: unknown): value is Date {
    return (
      Object.prototype.toString.call(value) === "[object Date]" &&
      typeof (value as Date).getTime === "function" &&
      !Number.isNaN((value as Date).getTime())
    );
  }

  private async hydrateRecords(
    executions: Array<Execution<TInput, TResult>>,
  ): Promise<Array<DurableExecutionRecord<TInput, TResult>>> {
    return await Promise.all(
      executions.map(async (execution) =>
        this.hydrateTypedRecord(execution, execution),
      ),
    );
  }

  private buildChildrenByParent(
    executions: Array<Execution<unknown, unknown>>,
  ): Map<string, Array<Execution<unknown, unknown>>> {
    const childrenByParent = new Map<
      string,
      Array<Execution<unknown, unknown>>
    >();

    for (const execution of executions) {
      if (!execution.parentExecutionId) {
        continue;
      }

      const list = childrenByParent.get(execution.parentExecutionId) ?? [];
      list.push(execution);
      childrenByParent.set(execution.parentExecutionId, list);
    }

    return childrenByParent;
  }

  private async hydrateRootTreeNode(
    execution: Execution<TInput, TResult>,
    childrenByParent: Map<string, Array<Execution<unknown, unknown>>>,
  ): Promise<DurableExecutionTreeNode<TInput, TResult>> {
    const record = await this.hydrateTypedRecord(execution, execution);
    const children = childrenByParent.get(execution.id) ?? [];

    return {
      ...record,
      children: await Promise.all(
        children.map(
          async (child) =>
            await this.hydrateAnyTreeNode(child, childrenByParent),
        ),
      ),
    };
  }

  private async hydrateAnyTreeNode(
    execution: Execution<unknown, unknown>,
    childrenByParent: Map<string, Array<Execution<unknown, unknown>>>,
  ): Promise<UntypedExecutionTreeNode> {
    const record = await this.hydrateRecord(execution, execution);
    const children = childrenByParent.get(execution.id) ?? [];

    return {
      ...record,
      children: await Promise.all(
        children.map(
          async (child) =>
            await this.hydrateAnyTreeNode(child, childrenByParent),
        ),
      ),
    };
  }

  private async hydrateTypedRecord(
    fallbackExecution: Execution<TInput, TResult>,
    executionForLookup: Execution,
  ): Promise<DurableExecutionRecord<TInput, TResult>> {
    const record = await this.hydrateRecord(
      fallbackExecution,
      executionForLookup,
    );
    return record as DurableExecutionRecord<TInput, TResult>;
  }

  private async hydrateRecord(
    fallbackExecution: Execution<unknown, unknown>,
    executionForLookup: Execution,
  ): Promise<UntypedExecutionRecord> {
    const [storedExecution, steps, audit] = await Promise.all([
      this.options.store.getExecution(executionForLookup.id),
      this.options.store.listStepResults(executionForLookup.id),
      this.options.store.listAuditEntries
        ? this.options.store.listAuditEntries(executionForLookup.id)
        : Promise.resolve([]),
    ]);

    return {
      execution: storedExecution ?? fallbackExecution,
      steps,
      audit,
    };
  }
}
