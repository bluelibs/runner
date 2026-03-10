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
  symbolDefinitionIdentity,
  symbolFilePath,
  symbolOptionalDependency,
} from "../types/symbols";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze, freezeIfLineageLocked } from "../tools/deepFreeze";
import { assertTagTargetsApplicableTo } from "./assertTagTargetsApplicable";
import { assertDefinitionId } from "./assertDefinitionId";
import { isFrameworkDefinitionMarked } from "./markFrameworkDefinition";
import {
  isClassConstructor,
  hasParseFunction,
  isObjectRecord,
} from "../tools/typeChecks";
import type {
  IValidationSchema,
  ValidationSchemaInput,
} from "../types/utilities";
import { isSameDefinition } from "../tools/isSameDefinition";

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
  public readonly [symbolDefinitionIdentity]?: object;
  constructor(
    public readonly id: string,
    message: string,
    data: TData,
    httpCode?: number,
    remediation?: string,
    definitionIdentity?: object,
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
    this[symbolDefinitionIdentity] = definitionIdentity;
  }
}

export class ErrorHelper<
  TData extends DefaultErrorType = DefaultErrorType,
> implements IErrorHelper<TData> {
  [symbolError] = true as const;
  [symbolFilePath]: string;
  [symbolDefinitionIdentity]?: object;
  constructor(
    private readonly definition: IErrorDefinitionFinal<TData>,
    filePath: string,
    definitionIdentity?: object,
  ) {
    this[symbolFilePath] = filePath;
    this[symbolDefinitionIdentity] = definitionIdentity;
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
      this[symbolDefinitionIdentity],
    );
  }
  ["new"](...args: ErrorThrowArgs<TData>): RunnerError<TData> {
    return this.buildRunnerError(...args);
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
      isSameDefinition(this, error) &&
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
  const resolvedFilePath = filePath ?? getCallerFile();
  assertDefinitionId("Error", definition.id, {
    allowReservedDottedNamespace: isFrameworkDefinitionMarked(definition),
  });

  if (definition.httpCode !== undefined) {
    assertHttpCode(definition.httpCode);
  }

  if (!definition.format) {
    definition.format = (data) => `${JSON.stringify(data)}`;
  }

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
  const definitionIdentity = {};

  return deepFreeze(
    new ErrorHelper<TData>(
      finalDefinition,
      resolvedFilePath,
      definitionIdentity,
    ),
  );
}
