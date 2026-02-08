import {
  DefaultErrorType,
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

/** Resolves remediation advice from a static string or a data-dependent function. */
function resolveRemediation<TData extends DefaultErrorType>(
  remediation: string | ((data: TData) => string) | undefined,
  data: TData,
): string | undefined {
  if (remediation === undefined) return undefined;
  return typeof remediation === "function" ? remediation(data) : remediation;
}

class RunnerError<
  TData extends DefaultErrorType = DefaultErrorType,
> extends Error {
  public readonly data!: TData;
  public readonly remediation?: string;
  constructor(
    public readonly id: string,
    message: string,
    data: TData,
    remediation?: string,
  ) {
    super(
      remediation !== undefined
        ? `${message}\n\nRemediation: ${remediation}`
        : message,
    );
    this.data = data;
    this.name = id;
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
  throw(data: TData): never {
    const parsed = this.definition.dataSchema
      ? this.definition.dataSchema.parse(data)
      : data;

    const message = this.definition.format(parsed);
    const remediation = resolveRemediation(this.definition.remediation, parsed);
    throw new RunnerError(this.definition.id, message, parsed, remediation);
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
  filePath?: string,
) {
  if (!definition.format) {
    definition.format = (data) => `${JSON.stringify(data)}`;
  }

  const resolvedFilePath = filePath ?? getCallerFile();

  return new ErrorHelper<TData>(
    definition as IErrorDefinitionFinal<TData>,
    resolvedFilePath,
  );
}
