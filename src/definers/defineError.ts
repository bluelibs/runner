import {
  DefaultErrorType,
  ErrorThrowArgs,
  IErrorDefinition,
  IErrorHelper,
  IErrorDefinitionFinal,
} from "../types/error";
import type { IErrorMeta } from "../types/meta";
import type { TagType } from "../types/tag";
import {
  symbolError,
  symbolFilePath,
  symbolOptionalDependency,
} from "../types/symbols";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze, freezeIfLineageLocked } from "../tools/deepFreeze";
import { assertTagTargetsApplicableTo } from "./assertTagTargetsApplicable";
import { assertDefinitionId } from "./assertDefinitionId";
import type {
  IValidationSchema,
  ValidationSchemaInput,
} from "../types/utilities";

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

const isClassConstructor = (
  value: unknown,
): value is abstract new (...args: never[]) => unknown => {
  if (typeof value !== "function") return false;

  const prototype = (value as { prototype?: unknown }).prototype;
  if (!prototype || typeof prototype !== "object") return false;

  return (prototype as { constructor?: unknown }).constructor === value;
};

const hasParseFunction = <T>(value: unknown): value is IValidationSchema<T> => {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    return false;
  }

  return typeof (value as { parse?: unknown }).parse === "function";
};

const normalizeErrorDataSchema = <TData extends DefaultErrorType>(
  schema: ValidationSchemaInput<TData> | undefined,
  errorId: string,
): IValidationSchema<TData> | undefined => {
  if (schema === undefined) {
    return undefined;
  }

  if (hasParseFunction<TData>(schema)) {
    return schema;
  }

  const checkModule =
    require("../tools/check") as typeof import("../tools/check");

  if (isClassConstructor(schema)) {
    const classSchemaModule =
      require("../tools/check/classSchema") as typeof import("../tools/check/classSchema");
    if (!classSchemaModule.hasClassSchemaMetadata(schema)) {
      throw new RunnerError(
        "runner.errors.validation",
        `Error data validation failed for ${errorId}: Class schema shorthand requires @Match.Schema() metadata for ${schema.name || "Anonymous"}.`,
        {
          subject: "Error data",
          id: errorId,
          originalError: "Missing @Match.Schema() metadata",
        },
      );
    }

    return checkModule.Match.fromSchema(schema) as IValidationSchema<TData>;
  }

  return {
    parse(input: unknown): TData {
      return checkModule.check(input, schema as never) as TData;
    },
  };
};

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
  get tags(): TagType[] {
    return this.definition.tags ?? [];
  }
  get meta(): IErrorMeta {
    return this.definition.meta ?? {};
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
  /** @deprecated use .new() or .throw() for better DX */
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
    const wrapper = {
      inner: this as IErrorHelper<TData>,
      [symbolOptionalDependency]: true,
    } as const;
    return freezeIfLineageLocked(this, wrapper);
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
  assertDefinitionId("Error", definition.id);

  if (definition.httpCode !== undefined) {
    assertHttpCode(definition.httpCode);
  }

  if (!definition.format) {
    definition.format = (data) => `${JSON.stringify(data)}`;
  }

  const resolvedFilePath = filePath ?? getCallerFile();
  assertTagTargetsApplicableTo(
    "errors",
    "Error",
    definition.id,
    definition.tags,
  );

  const finalDefinition: IErrorDefinitionFinal<TData> = {
    ...definition,
    format: definition.format,
    dataSchema: normalizeErrorDataSchema(definition.dataSchema, definition.id),
  } as IErrorDefinitionFinal<TData>;

  return deepFreeze(new ErrorHelper<TData>(finalDefinition, resolvedFilePath));
}
