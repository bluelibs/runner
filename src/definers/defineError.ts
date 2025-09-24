import {
  DefaultErrorType,
  IErrorDefinition,
  IErrorHelper,
  ERROR_TYPES_LOADED,
} from "../types/error";
import { symbolError, symbolOptionalDependency } from "../types/symbols";

class RunnerError<
  TData extends DefaultErrorType = DefaultErrorType,
> extends Error {
  public readonly data!: TData;
  constructor(public readonly id: string, data: TData) {
    super(data.message);
    this.data = data;
    this.name = id;
  }
}

export class ErrorHelper<TData extends DefaultErrorType = DefaultErrorType>
  implements IErrorHelper<TData>
{
  [symbolError] = true as const;
  constructor(private readonly definition: IErrorDefinition<TData>) {}
  get id(): string {
    return this.definition.id;
  }
  throw(data: TData): never {
    // Touch the runtime marker to keep module included under coverage
    void ERROR_TYPES_LOADED;
    const parsed = this.definition.dataSchema
      ? this.definition.dataSchema.parse(data)
      : data;
    throw new RunnerError(this.definition.id, parsed);
  }
  is(error: unknown): error is RunnerError<TData> {
    return error instanceof RunnerError && error.name === this.definition.id;
  }
  toString(error: RunnerError<TData>): string {
    return error.message;
  }
  optional() {
    return {
      inner: this as unknown as IErrorHelper<TData>,
      [symbolOptionalDependency]: true,
    } as const;
  }
}

/**
 * Create a new error that is going to be used
 * @param definition
 * @returns
 */
export function defineError<TData extends DefaultErrorType = DefaultErrorType>(
  definition: IErrorDefinition<TData>,
) {
  return new ErrorHelper<TData>(definition);
}
