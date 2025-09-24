import { DefaultErrorType, IErrorDefinition } from "../types/error";

class RunnerError<
  TData extends DefaultErrorType = DefaultErrorType,
> extends Error {
  constructor(id: string, data: TData) {
    super(data.message);
    this.name = id;
  }
}

export class ErrorHelper<TData extends DefaultErrorType = DefaultErrorType> {
  constructor(private readonly definition: IErrorDefinition<TData>) {
    this.definition = definition;
  }
  throw(data: TData) {
    throw new RunnerError(this.definition.id, data);
  }
  is(error: unknown): error is RunnerError<TData> {
    return error instanceof RunnerError && error.name === this.definition.id;
  }
  toString(error: RunnerError<TData>) {
    return error.message;
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
