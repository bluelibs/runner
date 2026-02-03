import {
  DefaultErrorType,
  IErrorDefinition,
  IErrorHelper,
  IErrorDefinitionFinal,
} from "../types/error";
import { symbolError, symbolOptionalDependency } from "../types/symbols";

class RunnerError<
  TData extends DefaultErrorType = DefaultErrorType,
> extends Error {
  public readonly data!: TData;
  constructor(
    public readonly id: string,
    message: string,
    data: TData,
  ) {
    super(message);
    this.data = data;
    this.name = id;
  }
}

export class ErrorHelper<
  TData extends DefaultErrorType = DefaultErrorType,
> implements IErrorHelper<TData> {
  [symbolError] = true as const;
  constructor(private readonly definition: IErrorDefinitionFinal<TData>) {}
  get id(): string {
    return this.definition.id;
  }
  throw(data: TData): never {
    const parsed = this.definition.dataSchema
      ? this.definition.dataSchema.parse(data)
      : data;

    const message = this.definition.format(parsed);
    throw new RunnerError(this.definition.id, message, parsed);
  }
  is(error: unknown): error is RunnerError<TData> {
    return error instanceof RunnerError && error.name === this.definition.id;
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
  if (!definition.format) {
    definition.format = (data) => `${JSON.stringify(data)}`;
  }

  return new ErrorHelper<TData>(definition as IErrorDefinitionFinal<TData>);
}
