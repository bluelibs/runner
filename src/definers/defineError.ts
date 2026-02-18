import {
  DefaultErrorType,
  ErrorThrowArgs,
  IErrorDefinition,
  IErrorHelper,
  IErrorDefinitionFinal,
} from "../types/error";
import {
  symbolError,
  symbolFilePath,
  symbolOptionalDependency,
} from "../types/symbols";
import { getCallerFile } from "../tools/getCallerFile";

const isValidHttpCode = (value: number): boolean =>
  Number.isInteger(value) && value >= 100 && value <= 599;

const assertHttpCode = (value: number): void => {
  if (!isValidHttpCode(value)) {
    throw new RunnerError(
      "runner.errors.error.invalidHttpCode",
      `Error httpCode must be an integer between 100 and 599. Received: ${value}`,
      { value },
    );
  }
};

export const matchesRunnerErrorData = <
  TData extends DefaultErrorType = DefaultErrorType,
>(
  data: TData,
  partialData?: Partial<TData>,
): boolean => {
  if (partialData === undefined) {
    return true;
  }

  for (const [key, value] of Object.entries(partialData)) {
    if (data[key] !== value) {
      return false;
    }
  }

  return true;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

export class RunnerError<
  TData extends DefaultErrorType = DefaultErrorType,
> extends Error {
  public readonly data!: TData;
  public readonly httpCode?: number;
  public readonly remediation?: string;
  constructor(
    public readonly id: string,
    message: string,
    data: TData,
    httpCode?: number,
    remediation?: string,
  ) {
    super(
      remediation !== undefined
        ? `${message}\n\nRemediation: ${remediation}`
        : message,
    );
    this.data = data;
    this.name = id;
    this.httpCode = httpCode;
    this.remediation = remediation;
  }
}

export class ErrorHelper<
  TData extends DefaultErrorType = DefaultErrorType,
> implements IErrorHelper<TData> {
  [symbolError] = true as const;
  [symbolFilePath]: string;
  constructor(
    private readonly definition: IErrorDefinitionFinal<TData>,
    filePath: string,
  ) {
    this[symbolFilePath] = filePath;
  }
  get id(): string {
    return this.definition.id;
  }
  get httpCode(): number | undefined {
    return this.definition.httpCode;
  }
  private buildRunnerError(...args: ErrorThrowArgs<TData>): RunnerError<TData> {
    const data = (args[0] ?? ({} as TData)) as TData;
    const parsed = this.definition.dataSchema
      ? this.definition.dataSchema.parse(data)
      : data;

    const message = this.definition.format(parsed);
    const remediation =
      typeof this.definition.remediation === "function"
        ? this.definition.remediation(parsed)
        : this.definition.remediation;
    return new RunnerError(
      this.definition.id,
      message,
      parsed,
      this.definition.httpCode,
      remediation,
    );
  }
  ["new"](...args: ErrorThrowArgs<TData>): RunnerError<TData> {
    return this.buildRunnerError(...args);
  }
  create(...args: ErrorThrowArgs<TData>): RunnerError<TData> {
    return this["new"](...args);
  }
  throw(...args: ErrorThrowArgs<TData>): never {
    throw this.buildRunnerError(...args);
  }
  is(error: unknown): error is RunnerError<TData>;
  is(error: unknown, partialData: Partial<TData>): error is RunnerError<TData>;
  is(error: unknown, partialData?: unknown): error is RunnerError<TData> {
    const safePartialData = isObjectRecord(partialData)
      ? (partialData as Partial<TData>)
      : undefined;

    return (
      error instanceof RunnerError &&
      error.name === this.definition.id &&
      matchesRunnerErrorData(error.data, safePartialData)
    );
  }
  optional() {
    return {
      inner: this as IErrorHelper<TData>,
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
  filePath?: string,
) {
  if (definition.httpCode !== undefined) {
    assertHttpCode(definition.httpCode);
  }

  if (!definition.format) {
    definition.format = (data) => `${JSON.stringify(data)}`;
  }

  const resolvedFilePath = filePath ?? getCallerFile();

  return new ErrorHelper<TData>(
    definition as IErrorDefinitionFinal<TData>,
    resolvedFilePath,
  );
}
